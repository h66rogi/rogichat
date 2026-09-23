import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MusixmatchQuotaExceededError,
  MusixmatchQuotaService,
} from './musixmatch-quota.service';

/**
 * MusixmatchQuotaService unit tests.
 *
 * The service uses a SELECT … FOR UPDATE pattern inside a Prisma transaction
 * (spec Section 6.1). For unit tests we stub:
 *
 *   - $transaction(fn) — invokes fn(tx) where tx is a thin shim
 *   - tx.$executeRaw — INSERT IGNORE / UPDATE
 *   - tx.$queryRaw — SELECT … FOR UPDATE
 *
 * Each test scenario asserts (a) which buckets are validated, (b) which
 * counters are incremented, (c) when MusixmatchQuotaExceededError fires.
 */

interface FakeRow {
  calls: number;
  calls_lyrics: number;
  calls_translations: number;
  calls_analysis: number;
  calls_fingerprint: number;
}

function defaultRow(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    calls: 0,
    calls_lyrics: 0,
    calls_translations: 0,
    calls_analysis: 0,
    calls_fingerprint: 0,
    ...overrides,
  };
}

describe('MusixmatchQuotaService', () => {
  let prisma: jest.Mocked<{
    $transaction: jest.Mock;
    $executeRaw: jest.Mock;
    musixmatchUsageLog: { findUnique: jest.Mock };
  }>;
  let storedRow: FakeRow;
  let txExecuteRaw: jest.Mock;

  function build(
    overrides: Partial<{
      total: number;
      lyrics: number;
      bufferPct: number;
      timezone: string;
    }> = {},
  ): MusixmatchQuotaService {
    const config = {
      get: jest.fn((key: string) => {
        switch (key) {
          case 'MUSIXMATCH_QUOTA_TOTAL_DAILY':
            return overrides.total ?? 20000;
          case 'MUSIXMATCH_QUOTA_LYRICS_DAILY':
            return overrides.lyrics ?? 2000;
          case 'MUSIXMATCH_QUOTA_BUFFER_PCT':
            return overrides.bufferPct ?? 10;
          case 'MUSIXMATCH_QUOTA_TIMEZONE':
            return overrides.timezone ?? 'Asia/Seoul';
          default:
            return undefined;
        }
      }),
    } as unknown as ConfigService;
    return new MusixmatchQuotaService(
      prisma as unknown as PrismaService,
      config,
    );
  }

  beforeEach(() => {
    storedRow = defaultRow();
    txExecuteRaw = jest.fn().mockImplementation(async (template: TemplateStringsArray, ...values: unknown[]) => {
      const sql = template.join('?');
      // INSERT IGNORE: noop (storedRow already exists in test)
      if (/INSERT IGNORE/i.test(sql)) return 0;
      // UPDATE … SET counters: parse the increments and apply to storedRow.
      // Increments are passed as numbers in the values array. Order matches
      // the SET clause: calls, calls_lyrics, calls_translations,
      // calls_analysis, calls_fingerprint.
      if (/UPDATE musixmatch_usage_log\s+SET\s+calls/i.test(sql)) {
        const [incTotal, incLyrics, incTrans, incAnalysis, incFingerprint] =
          values as number[];
        storedRow.calls += incTotal;
        storedRow.calls_lyrics += incLyrics;
        storedRow.calls_translations += incTrans;
        storedRow.calls_analysis += incAnalysis;
        storedRow.calls_fingerprint += incFingerprint;
        return 1;
      }
      return 0;
    });

    const tx = {
      $executeRaw: txExecuteRaw,
      $queryRaw: jest.fn().mockImplementation(async () => [storedRow]),
    };

    prisma = {
      $transaction: jest.fn().mockImplementation(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)),
      $executeRaw: jest.fn().mockResolvedValue(1),
      musixmatchUsageLog: {
        findUnique: jest
          .fn()
          .mockImplementation(async () => ({
            date: new Date('2026-04-29'),
            calls: storedRow.calls,
            callsLyrics: storedRow.calls_lyrics,
            callsTranslations: storedRow.calls_translations,
            callsAnalysis: storedRow.calls_analysis,
            callsFingerprint: storedRow.calls_fingerprint,
            errors: 0,
            rateLimitHits: 0,
            endpoints: {},
            updatedAt: new Date(),
          })),
      },
    };
  });

  describe('reserve - non-lyrics endpoint (track.search)', () => {
    it('increments only the total bucket', async () => {
      const quota = build();
      await quota.reserve('track.search', 'normal');

      expect(storedRow.calls).toBe(1);
      expect(storedRow.calls_lyrics).toBe(0);
    });

    it('throws when total bucket would exceed the limit', async () => {
      const quota = build({ total: 100 });
      storedRow.calls = 100; // already at limit

      await expect(quota.reserve('track.search', 'normal')).rejects.toBeInstanceOf(
        MusixmatchQuotaExceededError,
      );
      // Importantly, the row is NOT incremented when reserve throws.
      expect(storedRow.calls).toBe(100);
    });

    it('does not consider lyrics bucket for non-lyrics endpoint', async () => {
      const quota = build({ total: 20000, lyrics: 100 });
      storedRow.calls_lyrics = 9999; // way over lyrics limit
      storedRow.calls = 5;

      await expect(
        quota.reserve('track.search', 'normal'),
      ).resolves.toBeUndefined();
      expect(storedRow.calls).toBe(6);
    });
  });

  describe('reserve - lyrics endpoint (track.lyrics.get)', () => {
    it('increments both total and lyrics buckets', async () => {
      const quota = build();
      await quota.reserve('track.lyrics.get', 'normal');

      expect(storedRow.calls).toBe(1);
      expect(storedRow.calls_lyrics).toBe(1);
    });

    it('throws on lyrics overflow with correct bucket name', async () => {
      const quota = build({ total: 100, lyrics: 50 });
      storedRow.calls = 30;
      storedRow.calls_lyrics = 50; // already at lyrics limit

      try {
        await quota.reserve('track.subtitle.get', 'normal');
        fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(MusixmatchQuotaExceededError);
        expect((err as MusixmatchQuotaExceededError).bucket).toBe('lyrics');
        expect((err as MusixmatchQuotaExceededError).endpoint).toBe(
          'track.subtitle.get',
        );
      }
      // No counter movement on rejection.
      expect(storedRow.calls).toBe(30);
      expect(storedRow.calls_lyrics).toBe(50);
    });

    it('treats track.subtitle.get and track.richsync.get as lyrics-bucket', async () => {
      const quota = build();
      await quota.reserve('track.richsync.get', 'normal');
      await quota.reserve('track.subtitle.get', 'normal');

      expect(storedRow.calls_lyrics).toBe(2);
      expect(storedRow.calls).toBe(2);
    });
  });

  describe('reserve - backfill mode buffer', () => {
    it('rejects in backfill mode 10% earlier than normal', async () => {
      const quota = build({ total: 20000, lyrics: 2000, bufferPct: 10 });
      // Effective lyrics limit in backfill = 1800.
      storedRow.calls_lyrics = 1800; // at backfill limit

      await expect(
        quota.reserve('track.lyrics.get', 'backfill'),
      ).rejects.toBeInstanceOf(MusixmatchQuotaExceededError);
    });

    it('allows the same call in normal mode that backfill rejects', async () => {
      const quota = build({ total: 20000, lyrics: 2000, bufferPct: 10 });
      storedRow.calls_lyrics = 1800;
      storedRow.calls = 100;

      await expect(
        quota.reserve('track.lyrics.get', 'normal'),
      ).resolves.toBeUndefined();
      expect(storedRow.calls_lyrics).toBe(1801);
    });

    it('rejects in normal mode at the absolute limit', async () => {
      const quota = build({ total: 20000, lyrics: 2000, bufferPct: 10 });
      storedRow.calls_lyrics = 2000;

      await expect(
        quota.reserve('track.lyrics.get', 'normal'),
      ).rejects.toBeInstanceOf(MusixmatchQuotaExceededError);
    });
  });

  describe('reserve - cross-bucket isolation', () => {
    it('does not reject track.search when lyrics bucket is saturated', async () => {
      const quota = build({ total: 20000, lyrics: 2000 });
      storedRow.calls_lyrics = 2000; // lyrics fully used
      storedRow.calls = 100;

      await expect(
        quota.reserve('track.search', 'normal'),
      ).resolves.toBeUndefined();
      expect(storedRow.calls).toBe(101);
      // lyrics bucket not touched
      expect(storedRow.calls_lyrics).toBe(2000);
    });

    it('atomic transaction wraps the read+update', async () => {
      const quota = build();
      await quota.reserve('track.search', 'normal');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('reserve - per-attempt billing semantics', () => {
    it('multiple reserves accumulate (each retry counts)', async () => {
      const quota = build();
      await quota.reserve('track.lyrics.get', 'normal');
      await quota.reserve('track.lyrics.get', 'normal');
      await quota.reserve('track.lyrics.get', 'normal');

      expect(storedRow.calls).toBe(3);
      expect(storedRow.calls_lyrics).toBe(3);
    });
  });

  describe('recordOutcome', () => {
    it('updates error / rate-limit / endpoint counters', async () => {
      const quota = build();
      await quota.recordOutcome({
        endpoint: 'track.lyrics.get',
        success: false,
        rateLimitHit: true,
      });

      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      // SQL should reference the quoted JSON path (flat key, not nested).
      const sqlCall = prisma.$executeRaw.mock.calls[0];
      const template = sqlCall[0] as TemplateStringsArray;
      const values = sqlCall.slice(1);
      const sql = template.join('?');
      expect(sql).toContain('JSON_SET');
      // The JSON path argument should be the quoted form.
      expect(values).toContain('$."track.lyrics.get"');
    });
  });

  describe('getTodayUsage', () => {
    it('returns the row with limit info for admin dashboard', async () => {
      const quota = build({ total: 20000, lyrics: 2000 });
      storedRow.calls = 100;
      storedRow.calls_lyrics = 50;

      const usage = await quota.getTodayUsage();

      expect(usage.total).toBe(100);
      expect(usage.lyrics).toBe(50);
      expect(usage.limits.total).toBe(20000);
      expect(usage.limits.lyrics).toBe(2000);
    });

    it('returns zeros when no row exists', async () => {
      const quota = build();
      prisma.musixmatchUsageLog.findUnique.mockResolvedValue(null);

      const usage = await quota.getTodayUsage();

      expect(usage.total).toBe(0);
      expect(usage.lyrics).toBe(0);
    });
  });
});
