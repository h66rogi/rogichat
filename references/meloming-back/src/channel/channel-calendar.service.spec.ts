import { BadRequestException } from '@nestjs/common';
import { ChannelCalendarService } from './channel-calendar.service';
import { ResourceNotFoundException } from '../common/exceptions/custom.exception';

/**
 * Task 1.7 — channel unified calendar service unit tests.
 *
 * 검증 케이스 (spec self-review 9+):
 *   1. 정상 — 5 종 모두 반환 (schedules / broadcasts / setlists / anniversaries / clips)
 *   2. 종료된 broadcasts source → 빈 목록, 다른 source 는 정상 반환
 *   3. include 플래그 — 일부 source 만 fetch
 *   4. 비존재 channel → 404 (ResourceNotFoundException)
 *   5. window cap 초과 (13개월 초과) → BadRequest
 *   6. invalid from/to → BadRequest
 *   7. anniversary 자동 expansion (debutDate + birthday 모두 from~to 다수 인스턴스)
 *   8. PRIVATE schedule — currentUserId 가 본인이면 포함, 아니면 미포함
 *   9. 캐시 hit/miss
 *  10. broadcasts platform 매핑 (CHZZK / SOOP / CIME / YOUTUBE 모두)
 *  11. setlists 90 일 cap 초과 시 빈 배열 fallback
 *  12. clips: VISIBLE/deletedAt 필터, half-open boundary, isPrimary, songTitle, 부분 실패
 */
describe('ChannelCalendarService', () => {
  let service: ChannelCalendarService;
  let prisma: {
    channel: { findUnique: jest.Mock };
    channelManager: { findUnique: jest.Mock };
    channelSchedule: { findMany: jest.Mock };
    channelVerification: { findMany: jest.Mock };
    channelProfile: { findUnique: jest.Mock };
    clipChannel: { findMany: jest.Mock };
  };
  let channelService: { findByIdentifier: jest.Mock };
  let sessionService: { getPublicSetlists: jest.Mock };
  let cacheManager: { get: jest.Mock; set: jest.Mock };

  const channelOwner: any = {
    id: 42,
    userId: 7,
    name: '테스트 채널',
    webPath: 'test',
  };

  beforeEach(() => {
    prisma = {
      channel: { findUnique: jest.fn().mockResolvedValue({ userId: 7 }) },
      channelManager: { findUnique: jest.fn().mockResolvedValue(null) },
      channelSchedule: { findMany: jest.fn().mockResolvedValue([]) },
      channelVerification: { findMany: jest.fn().mockResolvedValue([]) },
      channelProfile: { findUnique: jest.fn().mockResolvedValue(null) },
      clipChannel: { findMany: jest.fn().mockResolvedValue([]) },
    };
    channelService = {
      findByIdentifier: jest.fn().mockResolvedValue(channelOwner),
    };
    sessionService = {
      getPublicSetlists: jest
        .fn()
        .mockResolvedValue({ setlists: [], total: 0, page: 1, limit: 50, totalPages: 0 }),
    };
    cacheManager = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    };

    service = new ChannelCalendarService(
      prisma as any,
      channelService as any,
      sessionService as any,
      cacheManager as any,
    );
  });

  const baseQuery = {
    from: '2026-04-01',
    to: '2026-05-31',
  } as any;

  describe('happy path', () => {
    it('returns all 5 sources successfully', async () => {
      // schedules
      prisma.channelSchedule.findMany.mockResolvedValueOnce([
        {
          id: 100,
          channelId: 42,
          authorUserId: 7,
          title: '정기 방송',
          content: null,
          startAt: new Date('2026-04-10T12:00:00.000Z'),
          endAt: new Date('2026-04-10T14:00:00.000Z'),
          allDay: false,
          isCanceled: false,
          status: 'LIVE',
          visibility: 'PUBLIC',
          location: null,
          externalUrl: null,
          createdAt: new Date('2026-04-01T00:00:00.000Z'),
          updatedAt: new Date('2026-04-01T00:00:00.000Z'),
          author: { id: 7, nickname: '주인장', profileImageUrl: null },
          channel: { id: 42, name: '테스트', profileImageUrl: null, webPath: 'test' },
        },
      ]);

      // setlists
      sessionService.getPublicSetlists.mockResolvedValueOnce({
        setlists: [
          {
            sessionId: 1,
            platform: 'CHZZK',
            startedAt: '2026-04-15T01:00:00.000Z',
            endedAt: '2026-04-15T03:00:00.000Z',
            completedCount: 5,
            durationMinutes: 120,
            albumArtPreviews: [],
            sessionKey: 'CHZZK:abc1234:2026-04-15T01:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        limit: 50,
        totalPages: 1,
      });

      // anniversaries
      prisma.channelProfile.findUnique.mockResolvedValueOnce({
        birthday: new Date('2000-04-20T00:00:00.000Z'),
        debutDate: new Date('2025-01-01T00:00:00.000Z'),
      });

      // clips
      prisma.clipChannel.findMany.mockResolvedValueOnce([
        {
          id: 1,
          clipId: 100,
          channelId: 42,
          songId: 555,
          isPrimary: true,
          createdAt: new Date('2026-04-15T01:30:00.000Z'),
          clip: {
            id: 100,
            title: '오늘의 노래 모음',
            description: null,
            platform: 'YOUTUBE',
            videoId: 'dQw4w9WgXcQ',
            videoUrl: null,
            thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
            duration: 213,
            status: 'VISIBLE',
            createdAt: new Date('2026-04-15T01:30:00.000Z'),
            updatedAt: new Date('2026-04-15T01:30:00.000Z'),
            deletedAt: null,
          },
          song: { title: 'Never Gonna Give You Up' },
        },
      ]);

      const result = await service.getCalendar('test', baseQuery);

      expect(result.channelId).toBe('42');
      expect(result.range).toEqual({ from: '2026-04-01', to: '2026-05-31' });
      expect(result.schedules).toHaveLength(1);
      expect(result.broadcasts).toEqual([]);
      expect(result.setlists).toHaveLength(1);
      expect(result.setlists[0].sessionKey).toBe(
        'CHZZK:abc1234:2026-04-15T01:00:00.000Z',
      );
      // 100일 마일스톤 + 4월 20일 생일 (range 2026-04-01 ~ 2026-05-31)
      expect(result.anniversaries.length).toBeGreaterThan(0);
      const types = result.anniversaries.map((a) => a.type);
      expect(types).toContain('BIRTHDAY');
      // clips
      expect(result.clips).toHaveLength(1);
      expect(result.clips[0].id).toBe(100);
      expect(result.clips[0].title).toBe('오늘의 노래 모음');
      expect(result.clips[0].platform).toBe('YOUTUBE');
      expect(result.clips[0].videoId).toBe('dQw4w9WgXcQ');
      expect(result.clips[0].duration).toBe(213);
      expect(result.clips[0].isPrimary).toBe(true);
      expect(result.clips[0].songTitle).toBe('Never Gonna Give You Up');
      expect(result.clips[0].createdAt).toBe('2026-04-15T01:30:00.000Z');
    });
  });

  describe('retired broadcast source fallback', () => {
    it('returns an empty broadcast list while preserving other calendar sources', async () => {
      sessionService.getPublicSetlists.mockResolvedValueOnce({
        setlists: [
          {
            sessionId: 1,
            platform: 'CHZZK',
            startedAt: '2026-04-15T01:00:00.000Z',
            endedAt: null,
            completedCount: 1,
            durationMinutes: null,
            albumArtPreviews: [],
            sessionKey: null,
          },
        ],
        total: 1,
        page: 1,
        limit: 50,
        totalPages: 1,
      });

      const result = await service.getCalendar('test', baseQuery);

      expect(result.broadcasts).toEqual([]);
      expect(prisma.channelVerification.findMany).not.toHaveBeenCalled();
      expect(result.setlists).toHaveLength(1);
    });
  });

  describe('include flags', () => {
    it('skips broadcasts when includeBroadcasts=false', async () => {
      const result = await service.getCalendar('test', {
        ...baseQuery,
        includeBroadcasts: false,
      });

      expect(prisma.channelVerification.findMany).not.toHaveBeenCalled();
      expect(result.broadcasts).toEqual([]);
    });

    it('skips schedules when includeSchedules=false', async () => {
      const result = await service.getCalendar('test', {
        ...baseQuery,
        includeSchedules: false,
      });

      expect(prisma.channelSchedule.findMany).not.toHaveBeenCalled();
      expect(result.schedules).toEqual([]);
    });

    it('skips setlists when includeSetlists=false', async () => {
      const result = await service.getCalendar('test', {
        ...baseQuery,
        includeSetlists: false,
      });

      expect(sessionService.getPublicSetlists).not.toHaveBeenCalled();
      expect(result.setlists).toEqual([]);
    });

    it('skips anniversaries when includeAnniversaries=false', async () => {
      const result = await service.getCalendar('test', {
        ...baseQuery,
        includeAnniversaries: false,
      });

      expect(prisma.channelProfile.findUnique).not.toHaveBeenCalled();
      expect(result.anniversaries).toEqual([]);
    });

    it('skips clips when includeClips=false', async () => {
      const result = await service.getCalendar('test', {
        ...baseQuery,
        includeClips: false,
      });

      expect(prisma.clipChannel.findMany).not.toHaveBeenCalled();
      expect(result.clips).toEqual([]);
    });
  });

  describe('channel not found', () => {
    it('propagates ResourceNotFoundException from findByIdentifier', async () => {
      channelService.findByIdentifier.mockRejectedValueOnce(
        new ResourceNotFoundException('채널을 찾을 수 없습니다.'),
      );

      await expect(
        service.getCalendar('does-not-exist', baseQuery),
      ).rejects.toBeInstanceOf(ResourceNotFoundException);
    });
  });

  describe('window validation', () => {
    it('throws BadRequest when range > 13 months', async () => {
      // 14 months from 2026-01-01
      await expect(
        service.getCalendar('test', {
          from: '2026-01-01',
          to: '2027-03-15',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts 403d boundary range (inclusive — ~13 months)', async () => {
      const from = new Date('2026-01-01T00:00:00.000Z');
      const to = new Date(
        from.getTime() + ChannelCalendarService.MAX_RANGE_MS_403D,
      );
      await expect(
        service.getCalendar('test', {
          from: from.toISOString(),
          to: to.toISOString(),
        } as any),
      ).resolves.toBeDefined();
    });

    it('throws BadRequest when to <= from', async () => {
      await expect(
        service.getCalendar('test', {
          from: '2026-04-15',
          to: '2026-04-15',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequest when from is invalid date', async () => {
      await expect(
        service.getCalendar('test', {
          from: 'not-a-date',
          to: '2026-04-30',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequest when to is invalid date', async () => {
      await expect(
        service.getCalendar('test', {
          from: '2026-04-01',
          to: 'not-a-date',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('anniversary expansion', () => {
    it('expands debutDate (100일 milestone) and birthday in range', async () => {
      // debutDate 2026-01-01 → 100일 = 2026-04-10 (within range 2026-04-01 ~ 2026-05-31)
      // birthday 2000-04-20 → 2026-04-20 (within range)
      prisma.channelProfile.findUnique.mockResolvedValueOnce({
        debutDate: new Date('2026-01-01T00:00:00.000Z'),
        birthday: new Date('2000-04-20T00:00:00.000Z'),
      });

      const result = await service.getCalendar('test', {
        from: '2026-04-01',
        to: '2026-05-31',
      } as any);

      const milestones = result.anniversaries.filter(
        (a) => a.type === 'BROADCAST_MILESTONE',
      );
      const birthdays = result.anniversaries.filter(
        (a) => a.type === 'BIRTHDAY',
      );

      expect(milestones.length).toBeGreaterThanOrEqual(1);
      expect(milestones[0].title).toBe('100일');
      expect(birthdays.length).toBe(1);
      expect(birthdays[0].title).toBe('생일');
      // 모두 source AUTO, id null
      for (const a of result.anniversaries) {
        expect(a.source).toBe('AUTO');
        expect(a.id).toBeNull();
      }
    });

    it('returns empty when no profile exists', async () => {
      prisma.channelProfile.findUnique.mockResolvedValueOnce(null);

      const result = await service.getCalendar('test', baseQuery);

      expect(result.anniversaries).toEqual([]);
    });

    it('returns empty when profile has no birthday and no debutDate', async () => {
      prisma.channelProfile.findUnique.mockResolvedValueOnce({
        birthday: null,
        debutDate: null,
      });

      const result = await service.getCalendar('test', baseQuery);

      expect(result.anniversaries).toEqual([]);
    });
  });

  describe('PRIVATE schedule visibility', () => {
    it('includes PRIVATE schedules for owner (currentUserId === channel.userId)', async () => {
      // owner 의 channel.userId === 7
      await service.getCalendar('test', baseQuery, 7);

      const findManyArg = prisma.channelSchedule.findMany.mock.calls[0][0];
      // owner 는 visibility 필터 없이 전체 조회
      expect(findManyArg.where.visibility).toBeUndefined();
    });

    it('includes PRIVATE schedules for active channel manager', async () => {
      prisma.channelManager.findUnique.mockResolvedValueOnce({ isActive: true });

      await service.getCalendar('test', baseQuery, 99); // 다른 user

      const findManyArg = prisma.channelSchedule.findMany.mock.calls[0][0];
      expect(findManyArg.where.visibility).toBeUndefined();
    });

    it('excludes PRIVATE schedules for non-owner non-manager', async () => {
      prisma.channelManager.findUnique.mockResolvedValueOnce(null);

      await service.getCalendar('test', baseQuery, 99);

      const findManyArg = prisma.channelSchedule.findMany.mock.calls[0][0];
      expect(findManyArg.where.visibility).toBe('PUBLIC');
    });

    it('excludes PRIVATE schedules for unauthenticated user', async () => {
      await service.getCalendar('test', baseQuery);

      const findManyArg = prisma.channelSchedule.findMany.mock.calls[0][0];
      expect(findManyArg.where.visibility).toBe('PUBLIC');
    });
  });

  describe('caching', () => {
    it('caches the response when currentUserId is missing', async () => {
      await service.getCalendar('test', baseQuery);

      expect(cacheManager.get).toHaveBeenCalledTimes(1);
      expect(cacheManager.set).toHaveBeenCalledTimes(1);
      expect(cacheManager.set.mock.calls[0][2]).toBe(
        ChannelCalendarService.CACHE_TTL_MS,
      );
    });

    it('returns cached response and skips fetch when cache hit', async () => {
      const cached = {
        channelId: '42',
        range: { from: baseQuery.from, to: baseQuery.to },
        schedules: [],
        broadcasts: [],
        setlists: [],
        anniversaries: [],
      };
      cacheManager.get.mockResolvedValueOnce(cached);

      const result = await service.getCalendar('test', baseQuery);

      expect(result).toEqual(cached);
      // fetch methods MUST NOT be called on cache hit
      expect(prisma.channelSchedule.findMany).not.toHaveBeenCalled();
      expect(prisma.channelVerification.findMany).not.toHaveBeenCalled();
      expect(sessionService.getPublicSetlists).not.toHaveBeenCalled();
    });

    it('does NOT cache when currentUserId is provided (PRIVATE schedule risk)', async () => {
      await service.getCalendar('test', baseQuery, 7);

      expect(cacheManager.get).not.toHaveBeenCalled();
      expect(cacheManager.set).not.toHaveBeenCalled();
    });
  });

  describe('setlists 90-day cap fallback', () => {
    it('returns empty setlists when range > 90 days (without calling sessionService)', async () => {
      // 100 days
      const from = new Date('2026-01-01T00:00:00.000Z');
      const to = new Date(from.getTime() + 100 * 86400000);

      const result = await service.getCalendar('test', {
        from: from.toISOString(),
        to: to.toISOString(),
      } as any);

      expect(result.setlists).toEqual([]);
      expect(sessionService.getPublicSetlists).not.toHaveBeenCalled();
    });
  });

  describe('clips', () => {
    /**
     * 5번째 데이터 소스 — 노래 클립.
     *
     * 검증:
     *   - half-open `[from, to)` boundary (gte from, lt to)
     *   - status VISIBLE 만, deletedAt null 만
     *   - 듀엣/단체곡: 한 클립이 여러 ClipChannel — 본 채널 시점 isPrimary 정확
     *   - songTitle: ClipChannel.song.title 매핑
     *   - clipChannel 없으면 빈 배열
     *   - prisma 호출 실패 → 다른 source 영향 없음
     *   - createdAt DESC 정렬
     */
    it('returns clips for the channel with isPrimary and songTitle correctly mapped', async () => {
      prisma.clipChannel.findMany.mockResolvedValueOnce([
        {
          id: 1,
          clipId: 100,
          channelId: 42,
          songId: 555,
          isPrimary: true,
          createdAt: new Date('2026-04-15T10:00:00.000Z'),
          clip: {
            id: 100,
            title: '메인 채널 클립',
            description: null,
            platform: 'YOUTUBE',
            videoId: 'main123',
            videoUrl: null,
            thumbnailUrl: 'https://thumb.example/main.jpg',
            duration: 180,
            status: 'VISIBLE',
            createdAt: new Date('2026-04-15T10:00:00.000Z'),
            updatedAt: new Date('2026-04-15T10:00:00.000Z'),
            deletedAt: null,
          },
          song: { title: '메인곡' },
        },
        {
          id: 2,
          clipId: 101,
          channelId: 42,
          songId: 556,
          isPrimary: false,
          createdAt: new Date('2026-04-10T09:00:00.000Z'),
          clip: {
            id: 101,
            title: '듀엣 출연 클립',
            description: null,
            platform: 'CHZZK',
            videoId: 'duet456',
            videoUrl: null,
            thumbnailUrl: null,
            duration: null,
            status: 'VISIBLE',
            createdAt: new Date('2026-04-10T09:00:00.000Z'),
            updatedAt: new Date('2026-04-10T09:00:00.000Z'),
            deletedAt: null,
          },
          song: { title: '듀엣곡' },
        },
      ]);

      const result = await service.getCalendar('test', baseQuery);

      expect(result.clips).toHaveLength(2);
      // 정렬은 prisma orderBy 에 위임 — mock 이 그대로 반환하므로 첫번째가 최신
      expect(result.clips[0].id).toBe(100);
      expect(result.clips[0].isPrimary).toBe(true);
      expect(result.clips[0].songTitle).toBe('메인곡');
      expect(result.clips[0].platform).toBe('YOUTUBE');
      expect(result.clips[0].duration).toBe(180);
      expect(result.clips[1].id).toBe(101);
      expect(result.clips[1].isPrimary).toBe(false);
      expect(result.clips[1].songTitle).toBe('듀엣곡');
      expect(result.clips[1].platform).toBe('CHZZK');
      expect(result.clips[1].duration).toBeNull();
      expect(result.clips[1].thumbnailUrl).toBeNull();
    });

    it('returns empty array when channel has no clips', async () => {
      prisma.clipChannel.findMany.mockResolvedValueOnce([]);

      const result = await service.getCalendar('test', baseQuery);

      expect(result.clips).toEqual([]);
    });

    it('uses half-open [from, to) boundary (gte from, lt to) on clip.createdAt', async () => {
      await service.getCalendar('test', baseQuery);

      expect(prisma.clipChannel.findMany).toHaveBeenCalledTimes(1);
      const arg = prisma.clipChannel.findMany.mock.calls[0][0];
      const from = new Date(baseQuery.from);
      const to = new Date(baseQuery.to);
      // where.channelId
      expect(arg.where.channelId).toBe(42);
      // where.clip.status === VISIBLE, deletedAt === null
      expect(arg.where.clip.status).toBe('VISIBLE');
      expect(arg.where.clip.deletedAt).toBeNull();
      // half-open: gte from, lt to
      expect(arg.where.clip.createdAt.gte.getTime()).toBe(from.getTime());
      expect(arg.where.clip.createdAt.lt.getTime()).toBe(to.getTime());
    });

    it('filters by status=VISIBLE and deletedAt=null in the where clause', async () => {
      await service.getCalendar('test', baseQuery);

      const arg = prisma.clipChannel.findMany.mock.calls[0][0];
      expect(arg.where.clip.status).toBe('VISIBLE');
      expect(arg.where.clip.deletedAt).toBeNull();
    });

    it('orders by clip.createdAt DESC', async () => {
      await service.getCalendar('test', baseQuery);

      const arg = prisma.clipChannel.findMany.mock.calls[0][0];
      expect(arg.orderBy).toEqual({ clip: { createdAt: 'desc' } });
    });

    it('does NOT impact other sources when clips fetch fails', async () => {
      prisma.clipChannel.findMany.mockRejectedValueOnce(new Error('DB 연결 실패'));

      const result = await service.getCalendar('test', baseQuery);

      expect(result.clips).toEqual([]);
      expect(result.broadcasts).toEqual([]);
    });

    it('falls back to clipChannel.createdAt when clip.createdAt is null', async () => {
      prisma.clipChannel.findMany.mockResolvedValueOnce([
        {
          id: 1,
          clipId: 200,
          channelId: 42,
          songId: 600,
          isPrimary: true,
          createdAt: new Date('2026-04-20T05:00:00.000Z'),
          clip: {
            id: 200,
            title: '레거시 클립',
            description: null,
            platform: 'OTHER',
            videoId: null,
            videoUrl: 'https://example.com/video.mp4',
            thumbnailUrl: null,
            duration: null,
            status: 'VISIBLE',
            // 방어 분기 — schema 상 nullable 이므로 null 케이스 가드
            createdAt: null,
            updatedAt: null,
            deletedAt: null,
          },
          song: { title: '레거시곡' },
        },
      ]);

      const result = await service.getCalendar('test', baseQuery);

      expect(result.clips).toHaveLength(1);
      expect(result.clips[0].createdAt).toBe('2026-04-20T05:00:00.000Z');
      expect(result.clips[0].videoId).toBeNull();
      expect(result.clips[0].videoUrl).toBe('https://example.com/video.mp4');
    });

    it('returns null songTitle when song relation has no title (defensive)', async () => {
      // 정상 schema 상 song 은 항상 존재 (필수). 방어적으로 null 가드 검증.
      prisma.clipChannel.findMany.mockResolvedValueOnce([
        {
          id: 1,
          clipId: 300,
          channelId: 42,
          songId: 700,
          isPrimary: true,
          createdAt: new Date('2026-04-22T05:00:00.000Z'),
          clip: {
            id: 300,
            title: '곡 정보 없는 클립',
            description: null,
            platform: 'SOOP',
            videoId: 'sp1',
            videoUrl: null,
            thumbnailUrl: null,
            duration: 60,
            status: 'VISIBLE',
            createdAt: new Date('2026-04-22T05:00:00.000Z'),
            updatedAt: new Date('2026-04-22T05:00:00.000Z'),
            deletedAt: null,
          },
          song: null,
        },
      ]);

      const result = await service.getCalendar('test', baseQuery);

      expect(result.clips).toHaveLength(1);
      expect(result.clips[0].songTitle).toBeNull();
    });
  });
});
