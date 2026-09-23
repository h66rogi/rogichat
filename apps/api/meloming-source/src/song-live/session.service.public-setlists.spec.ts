import { BadRequestException } from '@nestjs/common';
import { LiveSessionStatus, SongRequestStatus } from '@prisma/client';
import { SessionService } from './session.service';
import { ResourceNotFoundException } from '../common/exceptions/custom.exception';

/**
 * Task 1.4 — public setlists `from`/`to` 필터 + sessionKey 매핑.
 *
 * 채널 통합 캘린더 (월별 조회) 사용을 가정한 단위 테스트. service 레이어의
 * cross-field 검증 (둘 다, `to > from`, 90일 상한) 과 prisma where 절에
 * half-open `[from, to)` 가 들어가는지, sessionKey 가 정확한 형식으로
 * 매핑되는지를 확인한다.
 */
describe('SessionService.getPublicSetlists (range + sessionKey)', () => {
  let service: SessionService;
  let liveSessionFindMany: jest.Mock;
  let liveSessionCount: jest.Mock;
  let songRequestFindMany: jest.Mock;
  let resolveChannelIdByIdentifier: jest.Mock;

  const baseSession = {
    id: 1,
    platform: 'CHZZK' as const,
    platformChannelId: 'abc1234',
    startedAt: new Date('2026-04-15T01:00:00.000Z'),
    endedAt: new Date('2026-04-15T03:00:00.000Z'),
    _count: { songRequests: 5 },
  };

  beforeEach(() => {
    liveSessionFindMany = jest.fn().mockResolvedValue([baseSession]);
    liveSessionCount = jest.fn().mockResolvedValue(1);
    songRequestFindMany = jest.fn().mockResolvedValue([]);
    resolveChannelIdByIdentifier = jest.fn().mockResolvedValue(42);

    const prisma = {
      liveSession: {
        findMany: liveSessionFindMany,
        count: liveSessionCount,
      },
      songRequest: {
        findMany: songRequestFindMany,
      },
    };

    const channelService = {
      resolveChannelIdByIdentifier,
    };

    service = new SessionService(
      prisma as any,
      {} as any, // chzzkChatService
      {} as any, // soopChatService
      {} as any, // eventEmitter
      channelService as any,
      {} as any, // songRequestQueueService
      {} as any, // metricsService
      {} as any, // configService
      {} as any, // channelSongRequestSettingsService
      {} as any, // channelSongRequestSettingsNotifier
    );
  });

  describe('range filter (happy path)', () => {
    it('passes startedAt half-open [from, to) into prisma where', async () => {
      const from = '2026-04-01T00:00:00.000Z';
      const to = '2026-05-01T00:00:00.000Z';

      await service.getPublicSetlists('chan1', 1, 20, { from, to });

      expect(liveSessionFindMany).toHaveBeenCalledTimes(1);
      const arg = liveSessionFindMany.mock.calls[0][0];
      expect(arg.where).toMatchObject({
        channelId: 42,
        status: LiveSessionStatus.ENDED,
        visibility: 'PUBLIC',
        songRequests: { some: { status: SongRequestStatus.COMPLETED } },
        startedAt: {
          gte: new Date(from),
          lt: new Date(to),
        },
      });
      // count must use the same where (so totalPages is consistent with the page).
      expect(liveSessionCount).toHaveBeenCalledTimes(1);
      expect(liveSessionCount.mock.calls[0][0].where).toMatchObject({
        startedAt: {
          gte: new Date(from),
          lt: new Date(to),
        },
      });
    });

    it('omits startedAt filter when neither from nor to is provided', async () => {
      await service.getPublicSetlists('chan1', 1, 20);

      const arg = liveSessionFindMany.mock.calls[0][0];
      expect(arg.where.startedAt).toBeUndefined();
    });
  });

  describe('range filter (validation)', () => {
    it('throws BadRequest when only `from` is provided', async () => {
      await expect(
        service.getPublicSetlists('chan1', 1, 20, {
          from: '2026-04-01T00:00:00.000Z',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequest when only `to` is provided', async () => {
      await expect(
        service.getPublicSetlists('chan1', 1, 20, {
          to: '2026-04-01T00:00:00.000Z',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequest when to <= from (equal)', async () => {
      const t = '2026-04-01T00:00:00.000Z';
      await expect(
        service.getPublicSetlists('chan1', 1, 20, { from: t, to: t }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequest when to < from', async () => {
      await expect(
        service.getPublicSetlists('chan1', 1, 20, {
          from: '2026-05-01T00:00:00.000Z',
          to: '2026-04-01T00:00:00.000Z',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequest when range > 90 days', async () => {
      // 90 days + 1 hour
      await expect(
        service.getPublicSetlists('chan1', 1, 20, {
          from: '2026-01-01T00:00:00.000Z',
          to: '2026-04-01T01:00:00.000Z',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts exactly 90-day range (boundary inclusive)', async () => {
      const from = '2026-01-01T00:00:00.000Z';
      // 90 * 24 * 60 * 60 * 1000 ms exactly
      const to = new Date(
        new Date(from).getTime() + 90 * 24 * 60 * 60 * 1000,
      ).toISOString();

      await expect(
        service.getPublicSetlists('chan1', 1, 20, { from, to }),
      ).resolves.toBeDefined();

      const arg = liveSessionFindMany.mock.calls[0][0];
      expect(arg.where.startedAt).toEqual({
        gte: new Date(from),
        lt: new Date(to),
      });
    });

    it('throws BadRequest when from is not a valid date string', async () => {
      await expect(
        service.getPublicSetlists('chan1', 1, 20, {
          from: 'not-a-date',
          to: '2026-05-01T00:00:00.000Z',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('sessionKey mapping', () => {
    it('produces `${platform}:${platformChannelId}:${startedAt.toISOString()}` for fully populated sessions', async () => {
      const result = await service.getPublicSetlists('chan1', 1, 20);

      expect(result.setlists).toHaveLength(1);
      expect(result.setlists[0].sessionKey).toBe(
        'CHZZK:abc1234:2026-04-15T01:00:00.000Z',
      );
    });

    it('returns null sessionKey when platform is missing', async () => {
      liveSessionFindMany.mockResolvedValueOnce([
        { ...baseSession, platform: null },
      ]);

      const result = await service.getPublicSetlists('chan1', 1, 20);

      expect(result.setlists[0].sessionKey).toBeNull();
    });

    it('returns null sessionKey when platformChannelId is missing', async () => {
      liveSessionFindMany.mockResolvedValueOnce([
        { ...baseSession, platformChannelId: null },
      ]);

      const result = await service.getPublicSetlists('chan1', 1, 20);

      expect(result.setlists[0].sessionKey).toBeNull();
    });

    it('produces a distinct sessionKey per session', async () => {
      const sessions = [
        {
          ...baseSession,
          id: 10,
          platform: 'CHZZK' as const,
          platformChannelId: 'aaaa',
          startedAt: new Date('2026-04-15T01:00:00.000Z'),
        },
        {
          ...baseSession,
          id: 11,
          platform: 'SOOP' as const,
          platformChannelId: 'bbbb',
          startedAt: new Date('2026-04-15T05:00:00.000Z'),
        },
      ];
      liveSessionFindMany.mockResolvedValueOnce(sessions);
      liveSessionCount.mockResolvedValueOnce(2);

      const result = await service.getPublicSetlists('chan1', 1, 20);

      expect(result.setlists.map((s) => s.sessionKey)).toEqual([
        'CHZZK:aaaa:2026-04-15T01:00:00.000Z',
        'SOOP:bbbb:2026-04-15T05:00:00.000Z',
      ]);
    });
  });

  describe('channel resolution', () => {
    it('throws ResourceNotFound when channel does not resolve', async () => {
      resolveChannelIdByIdentifier.mockResolvedValueOnce(null);

      await expect(
        service.getPublicSetlists('does-not-exist', 1, 20),
      ).rejects.toBeInstanceOf(ResourceNotFoundException);
    });
  });
});
