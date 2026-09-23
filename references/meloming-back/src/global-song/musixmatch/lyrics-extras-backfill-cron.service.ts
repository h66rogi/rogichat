import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { DistributedLock } from '../../common/distributed-lock/distributed-lock.decorator';
import { DistributedLockService } from '../../common/distributed-lock/distributed-lock.service';
import { EnvironmentVariables } from '../../config/env.config';
import { LyricsExtrasBackfillService } from './lyrics-extras-backfill.service';

/**
 * Continuously recovers auxiliary lyrics data for already-stored lyrics rows.
 *
 * The matcher backfill cron only advances PENDING GlobalSongs. This cron is
 * intentionally separate so stored lyrics can keep recovering translations and
 * pronunciation after schema/display fields are added or a previous run stops
 * on quota. It uses the same Musixmatch backfill quota mode, so the quota
 * service remains the final safety boundary.
 */
@Injectable()
export class LyricsExtrasBackfillCronService {
  private readonly logger = new Logger(LyricsExtrasBackfillCronService.name);
  private readonly enabled: boolean;
  private readonly batchSize: number;
  private readonly includeTranslation: boolean;
  private readonly includePronunciation: boolean;

  constructor(
    private readonly lyricsExtrasBackfill: LyricsExtrasBackfillService,
    // Required by @DistributedLock.
    private readonly distributedLockService: DistributedLockService,
    configService: ConfigService<EnvironmentVariables>,
  ) {
    this.enabled =
      configService.get('MUSIXMATCH_LYRICS_EXTRAS_BACKFILL_ENABLED') ??
      configService.get('MUSIXMATCH_BACKFILL_ENABLED') ??
      false;

    const rawBatch =
      configService.get('MUSIXMATCH_LYRICS_EXTRAS_BACKFILL_BATCH_SIZE') ??
      configService.get('MUSIXMATCH_BACKFILL_BATCH_SIZE');
    this.batchSize = Math.max(
      1,
      Math.min(50, Number(rawBatch) > 0 ? Number(rawBatch) : 12),
    );

    this.includeTranslation =
      configService.get(
        'MUSIXMATCH_LYRICS_EXTRAS_BACKFILL_INCLUDE_TRANSLATION',
      ) ?? true;
    this.includePronunciation =
      configService.get(
        'MUSIXMATCH_LYRICS_EXTRAS_BACKFILL_INCLUDE_PRONUNCIATION',
      ) ?? true;
  }

  @Cron('*/15 * * * *', {
    name: 'musixmatch-lyrics-extras-backfill',
    timeZone: 'Asia/Seoul',
  })
  @DistributedLock(
    'cron:musixmatch:lyrics-extras-backfill',
    14 * 60 * 1000,
    2000,
  )
  async run(): Promise<void> {
    if (!this.enabled) return;
    await this.runOnce();
  }

  async runOnce(): Promise<{
    picked: number;
    processed: number;
    translationUpdated: number;
    translationUnavailable: number;
    pronunciationUpdated: number;
    pronunciationUnavailable: number;
    errors: number;
    haltReason: 'quota' | null;
  }> {
    const result = await this.lyricsExtrasBackfill.run({
      language: 'ja',
      limit: this.batchSize,
      dryRun: false,
      includeTranslation: this.includeTranslation,
      includePronunciation: this.includePronunciation,
    });

    this.logger.log(
      `musixmatch-lyrics-extras-backfill: picked=${result.picked} ` +
        `processed=${result.processed} translationUpdated=${result.translationUpdated} ` +
        `translationUnavailable=${result.translationUnavailable} ` +
        `pronunciationUpdated=${result.pronunciationUpdated} ` +
        `pronunciationUnavailable=${result.pronunciationUnavailable} ` +
        `errors=${result.errors}` +
        (result.haltReason ? ` halted=${result.haltReason}` : ''),
    );

    return {
      picked: result.picked,
      processed: result.processed,
      translationUpdated: result.translationUpdated,
      translationUnavailable: result.translationUnavailable,
      pronunciationUpdated: result.pronunciationUpdated,
      pronunciationUnavailable: result.pronunciationUnavailable,
      errors: result.errors,
      haltReason: result.haltReason,
    };
  }
}
