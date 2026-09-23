import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DistributedLockService } from '../common/distributed-lock/distributed-lock.service';
import { GlobalSongRedisService } from './global-song-redis.service';

/**
 * Backfill service for Song.globalSongId FK.
 *
 * Reads all (globalSongId -> channelId -> songId) mappings from Redis
 * `gs:{id}:channels` HASHes and writes globalSongId to the Song row.
 *
 * - Idempotent: only updates rows where globalSongId IS NULL
 * - Batched: collects 1000 mappings at a time, then runs a single raw
 *   UPDATE with CASE/WHEN per batch to avoid N+1
 * - Distributed lock via DistributedLockService to prevent concurrent runs
 * - Progress logging at 10% intervals
 * - Failed batches are logged but do not abort the entire run
 */
@Injectable()
export class GlobalSongBackfillService {
  private readonly logger = new Logger(GlobalSongBackfillService.name);

  private static readonly BATCH_SIZE = 1000;
  private static readonly LOCK_KEY = 'global-song:backfill-lock';
  private static readonly LOCK_TTL_MS = 30 * 60 * 1000; // 30 minutes

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: GlobalSongRedisService,
    private readonly lockService: DistributedLockService,
  ) {}

  /**
   * Pre-check before running backfill.
   * Returns 'running' if lock is held, 'redis_down' if Redis is not ready,
   * or null if ready to proceed (lock acquired successfully).
   *
   * When null is returned, the caller MUST call {@link backfill} to execute
   * the work (and release the lock). If non-null, no lock was acquired.
   */
  async tryAcquire(): Promise<'running' | 'redis_down' | null> {
    if (!this.redis.isReady()) {
      this.logger.warn('backfill() aborted: global-song Redis not ready');
      return 'redis_down';
    }

    const lockAcquired = await this.lockService.acquireLock(
      GlobalSongBackfillService.LOCK_KEY,
      GlobalSongBackfillService.LOCK_TTL_MS,
    );
    if (!lockAcquired) {
      this.logger.warn(
        'backfill() already in progress (distributed lock held)',
      );
      return 'running';
    }

    return null;
  }

  /**
   * Execute the backfill. Caller must have acquired the lock via
   * {@link tryAcquire} first. The lock is released in the finally block.
   */
  async backfill(): Promise<{
    updated: number;
    skipped: number;
    errors: number;
  }> {
    const startedAt = Date.now();
    this.logger.log('backfill() starting — scanning Redis channel mappings');

    try {
      // Phase 1: Collect all mappings from Redis into memory.
      // ~191K songs is manageable in-memory.
      const mappings: Array<{ songId: number; globalSongId: number }> = [];
      for await (const m of this.redis.scanAllChannelMappings()) {
        mappings.push({ songId: m.songId, globalSongId: m.globalSongId });
      }

      this.logger.log(
        `backfill: collected ${mappings.length} mappings from Redis`,
      );

      if (mappings.length === 0) {
        return { updated: 0, skipped: 0, errors: 0 };
      }

      // Phase 2: Batch update Song rows where globalSongId IS NULL
      // Uses a single raw UPDATE with CASE/WHEN per batch for efficiency.
      let updated = 0;
      let skipped = 0;
      let errors = 0;
      const totalBatches = Math.ceil(
        mappings.length / GlobalSongBackfillService.BATCH_SIZE,
      );
      let nextProgressPct = 10;

      for (
        let i = 0;
        i < mappings.length;
        i += GlobalSongBackfillService.BATCH_SIZE
      ) {
        const batch = mappings.slice(
          i,
          i + GlobalSongBackfillService.BATCH_SIZE,
        );
        const batchIndex = Math.floor(i / GlobalSongBackfillService.BATCH_SIZE);

        try {
          // Build raw SQL: UPDATE songs SET global_song_id = CASE id
          //   WHEN :songId1 THEN :gsId1 ... END
          // WHERE id IN (:ids) AND global_song_id IS NULL
          const caseFragments = batch.map(
            (m) => Prisma.sql`WHEN ${m.songId} THEN ${m.globalSongId}`,
          );
          const ids = batch.map((m) => m.songId);

          const result: number = await this.prisma.$executeRaw`
            UPDATE songs
            SET global_song_id = CASE id
              ${Prisma.join(caseFragments, ' ')}
            END
            WHERE id IN (${Prisma.join(ids)})
              AND global_song_id IS NULL
          `;

          updated += result;
          skipped += batch.length - result;
        } catch (error) {
          const from = i;
          const to = i + batch.length - 1;
          this.logger.error(
            `backfill: batch ${batchIndex + 1}/${totalBatches} failed (songId range ${batch[0]?.songId}..${batch[batch.length - 1]?.songId}, index ${from}..${to}): ${
              error instanceof Error ? error.message : error
            }`,
          );
          errors += batch.length;
        }

        // Progress logging at 10% intervals
        const pctDone = ((batchIndex + 1) / totalBatches) * 100;
        if (pctDone >= nextProgressPct) {
          const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
          this.logger.log(
            `backfill progress: ${Math.floor(pctDone)}% (updated=${updated}, skipped=${skipped}, errors=${errors}, elapsed=${elapsed}s)`,
          );
          nextProgressPct += 10;
        }
      }

      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      this.logger.log(
        `backfill complete: updated=${updated}, skipped=${skipped}, errors=${errors}, elapsed=${elapsed}s`,
      );
      return { updated, skipped, errors };
    } finally {
      await this.lockService
        .releaseLock(GlobalSongBackfillService.LOCK_KEY)
        .catch(() => undefined);
    }
  }
}
