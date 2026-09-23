import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { DistributedLock } from '../../common/distributed-lock/distributed-lock.decorator';
import { DistributedLockService } from '../../common/distributed-lock/distributed-lock.service';
import { EnvironmentVariables } from '../../config/env.config';
import { MusixmatchMatcherService } from './musixmatch-matcher.service';
import { MusixmatchCircuitOpenError } from './musixmatch.client';
import { MusixmatchQuotaExceededError } from './musixmatch-quota.service';

/**
 * Phase A2: Backfill cron — runs the matcher against PENDING global songs
 * in priority order (highest channel count first → Wave 1 → Wave 2 → ...).
 *
 * Default cadence: every 15 minutes, batch of 20 songs. With ~2.5 mxm calls
 * per match avg this lands at ~4,800 calls/day, well under the 7,200/day
 * quota. The quota service halts the run cleanly when its 90 % buffer fires.
 *
 * Disabled by default (`MUSIXMATCH_BACKFILL_ENABLED=false`). Enable per
 * environment via Vault. Distributed lock prevents concurrent runs across
 * pods.
 */
@Injectable()
export class MusixmatchBackfillCronService {
  private readonly logger = new Logger(MusixmatchBackfillCronService.name);
  private readonly enabled: boolean;
  private readonly batchSize: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly matcher: MusixmatchMatcherService,
    // Required by the `@DistributedLock` decorator on `run()` — the
    // decorator looks for `this.distributedLockService` at call time.
    private readonly distributedLockService: DistributedLockService,
    configService: ConfigService<EnvironmentVariables>,
  ) {
    this.enabled = configService.get('MUSIXMATCH_BACKFILL_ENABLED') ?? false;
    const rawBatch = configService.get('MUSIXMATCH_BACKFILL_BATCH_SIZE');
    this.batchSize = Math.max(
      1,
      Math.min(100, Number(rawBatch) > 0 ? Number(rawBatch) : 20),
    );
  }

  @Cron('*/15 * * * *', {
    name: 'musixmatch-backfill',
    timeZone: 'Asia/Seoul',
  })
  @DistributedLock('cron:musixmatch:backfill', 14 * 60 * 1000, 2000)
  async run(): Promise<void> {
    if (!this.enabled) return;
    await this.runOnce();
  }

  /**
   * Test seam — exposes the body of the cron without the decorator stack.
   */
  async runOnce(): Promise<{
    picked: number;
    processed: number;
    haltReason: 'quota' | 'circuit' | null;
  }> {
    const ids = await this.pickPending(this.batchSize);
    if (ids.length === 0) {
      this.logger.log('musixmatch-backfill: no PENDING songs left');
      return { picked: 0, processed: 0, haltReason: null };
    }

    this.logger.log(
      `musixmatch-backfill: picked ${ids.length} songs (batch size ${this.batchSize})`,
    );

    const counts: Record<string, number> = {};
    let processed = 0;
    let haltReason: 'quota' | 'circuit' | null = null;

    for (const id of ids) {
      try {
        const status = await this.matcher.maybeMatch(id, 'backfill');
        counts[status] = (counts[status] ?? 0) + 1;
        processed += 1;
      } catch (err) {
        if (err instanceof MusixmatchQuotaExceededError) {
          haltReason = 'quota';
          break;
        }
        if (err instanceof MusixmatchCircuitOpenError) {
          haltReason = 'circuit';
          break;
        }
        // Unexpected error — log and continue with next song.
        this.logger.error(
          `musixmatch-backfill: matcher threw for id=${id}: ${
            err instanceof Error ? err.message : err
          }`,
        );
        counts['ERROR_THROW'] = (counts['ERROR_THROW'] ?? 0) + 1;
      }
    }

    const summary = Object.entries(counts)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    this.logger.log(
      `musixmatch-backfill: processed ${processed}/${ids.length}` +
        (haltReason ? ` halted=${haltReason}` : '') +
        (summary ? ` ${summary}` : ''),
    );

    return { picked: ids.length, processed, haltReason };
  }

  /**
   * Pick PENDING songs ordered by distinct channel count desc — naturally
   * processes Wave 1 (>=100ch) before Wave 2 (>=10ch) etc. Subquery-based
   * count is acceptable at this scale (~57k global_songs, ~620k songs).
   */
  private async pickPending(limit: number): Promise<number[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: number }>>`
      SELECT g.id
      FROM global_songs g
      WHERE g.matcher_status = 'PENDING'
        AND g.matcher_attempts < 5
      ORDER BY (
        SELECT COUNT(DISTINCT s.channel_id)
        FROM songs s
        WHERE s.global_song_id = g.id
      ) DESC,
      g.id ASC
      LIMIT ${limit}
    `;
    return rows.map((r) => Number(r.id));
  }
}
