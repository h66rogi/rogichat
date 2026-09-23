import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { EnvironmentVariables } from '../../config/env.config';
import {
  ENDPOINT_BUCKETS,
  MUSIXMATCH_CONFIG,
  MxmEndpoint,
  QuotaBucket,
  QUOTA_DEFAULTS,
} from './musixmatch.constants';

/**
 * Per-bucket daily quota tracker for Musixmatch API.
 *
 * mxm Grow v2 has bucket-specific limits (spec Section 1.1):
 *   - 20k total / 2k lyrics / 2k translations / 1k analysis / 500 fingerprint
 *
 * mxm exposes no remaining-quota header; we count locally per call.
 *
 * Race-safe reserve via SELECT … FOR UPDATE inside a transaction (spec Section 6.1):
 *   1. Acquire row lock for today's row (insert-if-missing first).
 *   2. Read current counters; verify (current + delta) <= effective limit for
 *      EVERY bucket the endpoint touches (and only those).
 *   3. If any check fails, throw MusixmatchQuotaExceededError → transaction
 *      rolls back, no counter is incremented.
 *   4. Otherwise, increment the touched bucket counters.
 *
 * The reserve happens BEFORE every mxm HTTP attempt — including retries —
 * so retries also count, matching mxm's per-attempt billing.
 *
 * Mode 'backfill' applies an additional buffer (default 10%) so that the
 * normal/event-driven path always has headroom even when backfill saturates.
 */
@Injectable()
export class MusixmatchQuotaService {
  private readonly logger = new Logger(MusixmatchQuotaService.name);
  private readonly limits: Record<QuotaBucket, number>;
  private readonly bufferPct: number;
  private readonly timezone: string;

  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService<EnvironmentVariables>,
  ) {
    this.limits = {
      total:
        configService.get('MUSIXMATCH_QUOTA_TOTAL_DAILY') ??
        QUOTA_DEFAULTS.total,
      lyrics:
        configService.get('MUSIXMATCH_QUOTA_LYRICS_DAILY') ??
        QUOTA_DEFAULTS.lyrics,
      translations: QUOTA_DEFAULTS.translations,
      lyricsAnalysis: QUOTA_DEFAULTS.lyricsAnalysis,
      lyricsFingerprint: QUOTA_DEFAULTS.lyricsFingerprint,
    };
    this.bufferPct =
      configService.get('MUSIXMATCH_QUOTA_BUFFER_PCT') ??
      MUSIXMATCH_CONFIG.QUOTA_BUFFER_PCT_DEFAULT;
    this.timezone =
      configService.get('MUSIXMATCH_QUOTA_TIMEZONE') ??
      MUSIXMATCH_CONFIG.QUOTA_TIMEZONE_DEFAULT;
  }

  /**
   * Atomically reserve a slot in every bucket the endpoint touches.
   *
   * Throws {@link MusixmatchQuotaExceededError} if any touched bucket would
   * exceed its effective limit. Counts are charged per attempt (success and
   * failure alike) — call this before EVERY HTTP attempt including retries.
   */
  async reserve(
    endpoint: MxmEndpoint,
    mode: 'normal' | 'backfill',
  ): Promise<void> {
    const buckets = ENDPOINT_BUCKETS[endpoint];
    const today = this.todayDate();
    const buffer = mode === 'backfill' ? this.bufferPct / 100 : 0;
    const effective = (limit: number) => Math.floor(limit * (1 - buffer));

    await this.prisma.$transaction(async (tx) => {
      // Ensure today's row exists. INSERT IGNORE so concurrent transactions
      // can both call this without conflict.
      await tx.$executeRaw`
        INSERT IGNORE INTO musixmatch_usage_log
          (date, calls, calls_lyrics, calls_translations, calls_analysis, calls_fingerprint, errors, rate_limit_hits, endpoints, updated_at)
        VALUES
          (${today}, 0, 0, 0, 0, 0, 0, 0, '{}', NOW(3))
      `;

      // Lock today's row.
      const rows = await tx.$queryRaw<
        Array<{
          calls: number;
          calls_lyrics: number;
          calls_translations: number;
          calls_analysis: number;
          calls_fingerprint: number;
        }>
      >`
        SELECT calls, calls_lyrics, calls_translations, calls_analysis, calls_fingerprint
        FROM musixmatch_usage_log
        WHERE date = ${today}
        FOR UPDATE
      `;
      const row = rows[0];
      if (!row) {
        // Should not happen after INSERT IGNORE above.
        throw new MusixmatchQuotaExceededError(endpoint, 'total', mode);
      }

      // Validate every bucket this endpoint will touch.
      for (const bucket of buckets) {
        const current = this.bucketCurrent(row, bucket);
        const limit = effective(this.limits[bucket]);
        if (current + 1 > limit) {
          throw new MusixmatchQuotaExceededError(endpoint, bucket, mode);
        }
      }

      // All touched buckets are within limit — increment them.
      // Build a dynamic SET fragment via individual UPDATEs per bucket.
      // (Safe because the bucket set is a fixed enum.)
      const incTotal = buckets.includes('total') ? 1 : 0;
      const incLyrics = buckets.includes('lyrics') ? 1 : 0;
      const incTranslations = buckets.includes('translations') ? 1 : 0;
      const incAnalysis = buckets.includes('lyricsAnalysis') ? 1 : 0;
      const incFingerprint = buckets.includes('lyricsFingerprint') ? 1 : 0;

      await tx.$executeRaw`
        UPDATE musixmatch_usage_log
        SET
          calls = calls + ${incTotal},
          calls_lyrics = calls_lyrics + ${incLyrics},
          calls_translations = calls_translations + ${incTranslations},
          calls_analysis = calls_analysis + ${incAnalysis},
          calls_fingerprint = calls_fingerprint + ${incFingerprint},
          updated_at = NOW(3)
        WHERE date = ${today}
      `;
    });
  }

  /**
   * Record success/failure metadata for an already-reserved call. Increment
   * counts itself happens during reserve(); this only updates error/rate-limit
   * metadata and the per-endpoint detail counter.
   */
  async recordOutcome(params: {
    endpoint: MxmEndpoint;
    success: boolean;
    rateLimitHit?: boolean;
  }): Promise<void> {
    const { endpoint, success, rateLimitHit } = params;
    const today = this.todayDate();

    // Quote the dotted endpoint name as a single JSON key so e.g.
    // "track.search" stays flat ({"track.search": N}) instead of nested
    // ({"track": {"search": N}}).
    const jsonPath = `$."${endpoint}"`;

    await this.prisma.$executeRaw`
      UPDATE musixmatch_usage_log
      SET
        errors = errors + ${success ? 0 : 1},
        rate_limit_hits = rate_limit_hits + ${rateLimitHit ? 1 : 0},
        endpoints = JSON_SET(
          endpoints,
          ${jsonPath},
          COALESCE(JSON_EXTRACT(endpoints, ${jsonPath}), 0) + 1
        ),
        updated_at = NOW(3)
      WHERE date = ${today}
    `;
  }

  /** Today's row, useful for admin dashboards. */
  async getTodayUsage(): Promise<{
    date: Date;
    total: number;
    lyrics: number;
    translations: number;
    analysis: number;
    fingerprint: number;
    errors: number;
    rateLimitHits: number;
    limits: Record<QuotaBucket, number>;
  }> {
    const today = this.todayDate();
    const row = await this.prisma.musixmatchUsageLog.findUnique({
      where: { date: today },
    });
    return {
      date: today,
      total: row?.calls ?? 0,
      lyrics: row?.callsLyrics ?? 0,
      translations: row?.callsTranslations ?? 0,
      analysis: row?.callsAnalysis ?? 0,
      fingerprint: row?.callsFingerprint ?? 0,
      errors: row?.errors ?? 0,
      rateLimitHits: row?.rateLimitHits ?? 0,
      limits: this.limits,
    };
  }

  private bucketCurrent(
    row: {
      calls: number;
      calls_lyrics: number;
      calls_translations: number;
      calls_analysis: number;
      calls_fingerprint: number;
    },
    bucket: QuotaBucket,
  ): number {
    switch (bucket) {
      case 'total':
        return Number(row.calls);
      case 'lyrics':
        return Number(row.calls_lyrics);
      case 'translations':
        return Number(row.calls_translations);
      case 'lyricsAnalysis':
        return Number(row.calls_analysis);
      case 'lyricsFingerprint':
        return Number(row.calls_fingerprint);
    }
  }

  /**
   * Today's date at 00:00 in the configured quota timezone, returned as a
   * Date object whose value lines up with MySQL DATE column semantics.
   *
   * mxm dashboard timezone is unverified; default to Asia/Seoul (KST) so
   * counters reset at local midnight.
   */
  private todayDate(): Date {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return new Date(fmt.format(new Date()) + 'T00:00:00.000Z');
  }
}

export class MusixmatchQuotaExceededError extends Error {
  constructor(
    public readonly endpoint: MxmEndpoint,
    public readonly bucket: QuotaBucket,
    public readonly mode: 'normal' | 'backfill',
  ) {
    super(
      `Musixmatch quota exceeded for endpoint=${endpoint} bucket=${bucket} mode=${mode}`,
    );
    this.name = 'MusixmatchQuotaExceededError';
  }
}
