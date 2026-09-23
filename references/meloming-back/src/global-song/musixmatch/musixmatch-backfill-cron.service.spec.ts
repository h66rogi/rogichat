import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { DistributedLockService } from '../../common/distributed-lock/distributed-lock.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MusixmatchBackfillCronService } from './musixmatch-backfill-cron.service';
import { MusixmatchMatcherService } from './musixmatch-matcher.service';
import { MusixmatchCircuitOpenError } from './musixmatch.client';
import { MusixmatchQuotaExceededError } from './musixmatch-quota.service';

describe('MusixmatchBackfillCronService', () => {
  let service: MusixmatchBackfillCronService;
  let prisma: { $queryRaw: jest.Mock };
  let matcher: { maybeMatch: jest.Mock };

  const buildModule = async (cfg: Record<string, unknown> = {}) => {
    prisma = { $queryRaw: jest.fn() };
    matcher = { maybeMatch: jest.fn() };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        MusixmatchBackfillCronService,
        { provide: PrismaService, useValue: prisma },
        { provide: MusixmatchMatcherService, useValue: matcher },
        {
          provide: DistributedLockService,
          useValue: {
            acquireLock: jest.fn().mockResolvedValue(true),
            releaseLock: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) => cfg[k],
          },
        },
      ],
    }).compile();

    service = moduleRef.get(MusixmatchBackfillCronService);
  };

  describe('runOnce', () => {
    it('returns early when no PENDING songs', async () => {
      await buildModule({
        MUSIXMATCH_BACKFILL_ENABLED: true,
        MUSIXMATCH_BACKFILL_BATCH_SIZE: 5,
      });
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const out = await service.runOnce();

      expect(out).toEqual({ picked: 0, processed: 0, haltReason: null });
      expect(matcher.maybeMatch).not.toHaveBeenCalled();
    });

    it('processes batch in priority order', async () => {
      await buildModule({ MUSIXMATCH_BACKFILL_BATCH_SIZE: 3 });
      prisma.$queryRaw.mockResolvedValueOnce([
        { id: 100 },
        { id: 200 },
        { id: 300 },
      ]);
      matcher.maybeMatch
        .mockResolvedValueOnce('MATCHED')
        .mockResolvedValueOnce('UNMATCHED')
        .mockResolvedValueOnce('MATCHED');

      const out = await service.runOnce();

      expect(out.picked).toBe(3);
      expect(out.processed).toBe(3);
      expect(out.haltReason).toBeNull();
      expect(matcher.maybeMatch.mock.calls.map((c) => c[0])).toEqual([
        100, 200, 300,
      ]);
      expect(matcher.maybeMatch.mock.calls[0][1]).toBe('backfill');
    });

    it('halts on quota exceeded mid-batch', async () => {
      await buildModule({ MUSIXMATCH_BACKFILL_BATCH_SIZE: 5 });
      prisma.$queryRaw.mockResolvedValueOnce([
        { id: 1 },
        { id: 2 },
        { id: 3 },
      ]);
      matcher.maybeMatch
        .mockResolvedValueOnce('MATCHED')
        .mockRejectedValueOnce(
          new MusixmatchQuotaExceededError(
            'matcher.track.get',
            'total',
            'backfill',
          ),
        );

      const out = await service.runOnce();

      expect(out.processed).toBe(1);
      expect(out.haltReason).toBe('quota');
      expect(matcher.maybeMatch).toHaveBeenCalledTimes(2);
    });

    it('halts on circuit open mid-batch', async () => {
      await buildModule({ MUSIXMATCH_BACKFILL_BATCH_SIZE: 5 });
      prisma.$queryRaw.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
      matcher.maybeMatch.mockRejectedValueOnce(
        new MusixmatchCircuitOpenError(
          'matcher.track.get',
          new Date(Date.now() + 30 * 60 * 1000),
        ),
      );

      const out = await service.runOnce();

      expect(out.processed).toBe(0);
      expect(out.haltReason).toBe('circuit');
      expect(matcher.maybeMatch).toHaveBeenCalledTimes(1);
    });

    it('continues on unexpected per-song errors', async () => {
      await buildModule({ MUSIXMATCH_BACKFILL_BATCH_SIZE: 5 });
      prisma.$queryRaw.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
      matcher.maybeMatch
        .mockRejectedValueOnce(new Error('oops'))
        .mockResolvedValueOnce('MATCHED');

      const out = await service.runOnce();

      expect(out.processed).toBe(1); // only the second one counted as processed
      expect(out.haltReason).toBeNull();
      expect(matcher.maybeMatch).toHaveBeenCalledTimes(2);
    });

    it('clamps batch size into [1, 100] range', async () => {
      await buildModule({ MUSIXMATCH_BACKFILL_BATCH_SIZE: 9999 });
      prisma.$queryRaw.mockResolvedValueOnce([]);

      await service.runOnce();

      const limitArg = prisma.$queryRaw.mock.calls[0][1];
      expect(limitArg).toBe(100);
    });

    it('falls back to default batch size 20 when env unset', async () => {
      await buildModule({});
      prisma.$queryRaw.mockResolvedValueOnce([]);

      await service.runOnce();

      expect(prisma.$queryRaw.mock.calls[0][1]).toBe(20);
    });
  });
});
