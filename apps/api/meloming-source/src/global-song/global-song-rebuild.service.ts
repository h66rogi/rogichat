import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DistributedLockService } from '../common/distributed-lock/distributed-lock.service';
import { GlobalSongIndexerService } from './global-song-indexer.service';
import { GlobalSongRedisService } from './global-song-redis.service';

/**
 * Bootstrap + rebuild service for the global-song index.
 *
 * Used for:
 *   - Initial bootstrap when new Prisma tables are empty (scan every
 *     existing song row and index it)
 *   - Periodic rebuild to correct drift between live Redis state and DB
 *
 * Phase 1 only ships the `bootstrap()` entry point. The daily cron rebuild
 * described in spec Section 6 lands in a later phase - the mechanics are
 * the same but with version-fenced atomic index swaps.
 *
 * Concurrency control (two layers):
 *   1. In-memory flag prevents accidental parallel runs inside the same pod
 *   2. Redis distributed lock prevents parallel runs across pods
 *
 * Pre-processing before indexing: flush Redis index keys AND reset DB
 * channelCount to 0 on every GlobalSong row. This lets us re-derive the
 * counter from scratch by scanning the songs table, so reruns do not
 * inflate counts.
 *
 * Per-batch optimization: load all artists + categories for the batch in
 * one query each, then call indexSong with the pre-loaded data, avoiding
 * N+1 lookups.
 */
@Injectable()
export class GlobalSongRebuildService {
  private readonly logger = new Logger(GlobalSongRebuildService.name);
  private rebuilding = false;

  private static readonly BATCH_SIZE = 1000;
  private static readonly CONCURRENCY = 20;
  private static readonly PROGRESS_LOG_INTERVAL = 10_000;
  private static readonly LOCK_KEY = 'global-song:bootstrap-lock';
  private static readonly LOCK_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

  constructor(
    private readonly prisma: PrismaService,
    private readonly indexer: GlobalSongIndexerService,
    private readonly redis: GlobalSongRedisService,
    private readonly lockService: DistributedLockService,
  ) {}

  private chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }

  async bootstrap(): Promise<{ indexed: number; errors: number }> {
    if (this.rebuilding) {
      this.logger.warn('bootstrap() already in progress in this pod');
      return { indexed: 0, errors: 0 };
    }
    if (!this.redis.isReady()) {
      this.logger.warn('bootstrap() aborted: global-song Redis not ready');
      return { indexed: 0, errors: 0 };
    }

    // Acquire a cross-pod lock so two pods cannot rebuild simultaneously
    const lockAcquired = await this.lockService.acquireLock(
      GlobalSongRebuildService.LOCK_KEY,
      GlobalSongRebuildService.LOCK_TTL_MS,
    );
    if (!lockAcquired) {
      this.logger.warn('bootstrap() aborted: another pod holds the lock');
      return { indexed: 0, errors: 0 };
    }

    this.rebuilding = true;
    const startedAt = Date.now();
    this.logger.log(
      'bootstrap() starting - flushing Redis keys and resetting DB counters',
    );

    try {
      // Flush Redis index keys AND zero out DB counters so we re-derive
      // channelCount from scratch (idempotency under rerun).
      await this.redis.flushGlobalSongKeys();
      await this.prisma.globalSong.updateMany({
        data: { channelCount: 0 },
      });
      await this.prisma.globalArtistAlias.updateMany({
        data: { frequency: 0 },
      });

      let indexed = 0;
      let errors = 0;
      let cursor: number | undefined;
      let nextProgressThreshold =
        GlobalSongRebuildService.PROGRESS_LOG_INTERVAL;

      while (true) {
        const batch = await this.prisma.song.findMany({
          take: GlobalSongRebuildService.BATCH_SIZE,
          orderBy: { id: 'asc' },
          ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
          select: {
            id: true,
            title: true,
            channelId: true,
            albumArt: true,
            artist: { select: { name: true } },
          },
        });

        if (batch.length === 0) break;
        cursor = batch[batch.length - 1].id;

        // Pre-load all song_categories for this batch in one query
        const songIds = batch.map((s) => s.id);
        const songCategories = await this.prisma.songCategory.findMany({
          where: { songId: { in: songIds } },
          select: {
            songId: true,
            category: { select: { name: true } },
          },
        });
        const categoryNamesBySongId = new Map<number, string[]>();
        for (const sc of songCategories) {
          const existing = categoryNamesBySongId.get(sc.songId) ?? [];
          existing.push(sc.category.name);
          categoryNamesBySongId.set(sc.songId, existing);
        }

        // Process songs in parallel within the batch (bounded concurrency)
        const chunks = this.chunkArray(
          batch,
          GlobalSongRebuildService.CONCURRENCY,
        );
        for (const chunk of chunks) {
          const results = await Promise.allSettled(
            chunk.map((song) =>
              this.indexer.indexSong(
                song.id,
                song.title,
                song.artist?.name ?? '',
                song.channelId,
                song.albumArt,
                categoryNamesBySongId.get(song.id) ?? [],
              ),
            ),
          );
          for (const result of results) {
            if (result.status === 'fulfilled') {
              indexed++;
            } else {
              errors++;
              this.logger.error(
                `bootstrap: indexSong failed: ${result.reason}`,
              );
            }
          }
        }

        if (indexed >= nextProgressThreshold) {
          const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
          this.logger.log(
            `bootstrap progress: indexed=${indexed}, errors=${errors}, elapsed=${elapsed}s`,
          );
          nextProgressThreshold +=
            GlobalSongRebuildService.PROGRESS_LOG_INTERVAL;
        }
      }

      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      this.logger.log(
        `bootstrap complete: indexed=${indexed}, errors=${errors}, elapsed=${elapsed}s`,
      );
      return { indexed, errors };
    } finally {
      this.rebuilding = false;
      await this.lockService
        .releaseLock(GlobalSongRebuildService.LOCK_KEY)
        .catch((err) =>
          this.logger.warn(
            `bootstrap: failed to release lock: ${
              err instanceof Error ? err.message : err
            }`,
          ),
        );
    }
  }
}
