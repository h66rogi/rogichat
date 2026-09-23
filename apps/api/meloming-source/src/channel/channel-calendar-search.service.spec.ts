import { BadRequestException } from '@nestjs/common';
import { ChannelCalendarService } from './channel-calendar.service';
import { ResourceNotFoundException } from '../common/exceptions/custom.exception';

/**
 * 채널 통합 캘린더 검색 (`searchCalendar`) 단위 테스트.
 *
 * 검증 케이스:
 *   1. happy path — 일정/방송/노래방송/클립 매칭 결과를 date DESC 로 병합
 *   2. 기념일 검색 — 표시명 in-memory 필터 (생일)
 *   3. include 플래그 — 일부 소스만 검색
 *   4. 빈 키워드(trim 후 공백) → 빈 결과
 *   5. window cap 초과 → BadRequest
 *   6. 비존재 채널 → 404
 *   7. 부분 실패 — 한 소스 throw 시 나머지 반환
 *   8. PRIVATE 일정 visibility 분기 (owner / 비owner)
 *   9. 노래방송 검색 — SessionService.searchPublicSetlists 위임 (term + range)
 *  10. limit 상한 — total 은 상한 전 개수, items 는 상한 적용
 */
describe('ChannelCalendarService.searchCalendar', () => {
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
  let sessionService: {
    getPublicSetlists: jest.Mock;
    searchPublicSetlists: jest.Mock;
  };
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
      getPublicSetlists: jest.fn().mockResolvedValue({
        setlists: [],
        total: 0,
        page: 1,
        limit: 50,
        totalPages: 0,
      }),
      searchPublicSetlists: jest.fn().mockResolvedValue([]),
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

  const baseQuery = (overrides: Record<string, unknown> = {}) =>
    ({
      q: '테스트',
      from: '2026-04-01',
      to: '2026-05-31',
      ...overrides,
    }) as any;

  describe('happy path', () => {
    it('merges non-ranking matches sorted by date DESC', async () => {
      prisma.channelSchedule.findMany.mockResolvedValueOnce([
        {
          id: 100,
          title: '테스트 정기방송',
          content: null,
          location: '온라인',
          startAt: new Date('2026-04-10T12:00:00.000Z'),
        },
      ]);
      sessionService.searchPublicSetlists.mockResolvedValueOnce([
        {
          summary: {
            sessionId: 1,
            platform: 'CHZZK',
            platformChannelId: 'abc1234',
            startedAt: '2026-04-12T01:00:00.000Z',
            endedAt: '2026-04-12T03:00:00.000Z',
            completedCount: 5,
            durationMinutes: 120,
            albumArtPreviews: [],
            sessionKey: 'CHZZK:abc1234:2026-04-12T01:00:00.000Z',
          },
          matchedSongTitle: '테스트 곡',
        },
      ]);
      prisma.clipChannel.findMany.mockResolvedValueOnce([
        {
          id: 1,
          isPrimary: true,
          createdAt: new Date('2026-04-20T05:00:00.000Z'),
          clip: {
            id: 300,
            title: '테스트 클립',
            createdAt: new Date('2026-04-20T05:00:00.000Z'),
          },
          song: { title: '테스트 곡' },
        },
      ]);

      const result = await service.searchCalendar('test', baseQuery());

      expect(result.channelId).toBe('42');
      expect(result.query).toBe('테스트');
      expect(result.range).toEqual({ from: '2026-04-01', to: '2026-05-31' });
      expect(result.total).toBe(3);
      expect(result.items).toHaveLength(3);

      // date DESC: clip(04-20) > setlist(04-12) > schedule(04-10)
      expect(result.items.map((i) => i.type)).toEqual([
        'CLIP',
        'SETLIST',
        'SCHEDULE',
      ]);

      const schedule = result.items.find((i) => i.type === 'SCHEDULE')!;
      expect(schedule.scheduleId).toBe(100);
      expect(schedule.title).toBe('테스트 정기방송');
      expect(schedule.subtitle).toBe('온라인');

      const setlist = result.items.find((i) => i.type === 'SETLIST')!;
      expect(setlist.sessionId).toBe(1);
      expect(setlist.title).toBe('테스트 곡');
      expect(setlist.subtitle).toBe('노래 방송 · 5곡');

      const clip = result.items.find((i) => i.type === 'CLIP')!;
      expect(clip.clipId).toBe(300);
      expect(clip.subtitle).toBe('테스트 곡');
    });

    it('preserves the ranking-unavailable empty search fallback without a source query', async () => {
      const result = await service.searchCalendar('test', baseQuery());

      const broadcasts = result.items.filter((i) => i.type === 'BROADCAST');
      expect(broadcasts).toEqual([]);
      expect(prisma.channelVerification.findMany).not.toHaveBeenCalled();
    });
  });

  describe('anniversary search', () => {
    it('matches anniversary title (생일) and excludes others', async () => {
      prisma.channelProfile.findUnique.mockResolvedValueOnce({
        birthday: new Date('2000-04-20T00:00:00.000Z'),
        debutDate: new Date('2026-01-01T00:00:00.000Z'),
      });

      const result = await service.searchCalendar('test', baseQuery({ q: '생일' }));

      const anniversaries = result.items.filter((i) => i.type === 'ANNIVERSARY');
      expect(anniversaries.length).toBeGreaterThanOrEqual(1);
      expect(anniversaries.every((a) => a.title.includes('생일'))).toBe(true);
      expect(anniversaries[0].anniversaryType).toBe('BIRTHDAY');
      // 100일 마일스톤은 '생일' 키워드와 매칭 안 됨
      expect(
        result.items.some((i) => i.title === '100일'),
      ).toBe(false);
    });
  });

  describe('include flags', () => {
    it('skips broadcasts when includeBroadcasts=false', async () => {
      await service.searchCalendar('test', baseQuery({ includeBroadcasts: false }));
      expect(prisma.channelVerification.findMany).not.toHaveBeenCalled();
    });

    it('skips setlists when includeSetlists=false', async () => {
      await service.searchCalendar('test', baseQuery({ includeSetlists: false }));
      expect(sessionService.searchPublicSetlists).not.toHaveBeenCalled();
    });

    it('skips clips when includeClips=false', async () => {
      await service.searchCalendar('test', baseQuery({ includeClips: false }));
      expect(prisma.clipChannel.findMany).not.toHaveBeenCalled();
    });
  });

  describe('empty keyword', () => {
    it('returns empty result without querying any source when q is blank', async () => {
      const result = await service.searchCalendar('test', baseQuery({ q: '   ' }));
      expect(result.total).toBe(0);
      expect(result.items).toEqual([]);
      expect(prisma.channelSchedule.findMany).not.toHaveBeenCalled();
      expect(sessionService.searchPublicSetlists).not.toHaveBeenCalled();
    });
  });

  describe('window validation', () => {
    it('throws BadRequest when range > 13 months', async () => {
      await expect(
        service.searchCalendar(
          'test',
          baseQuery({ from: '2026-01-01', to: '2027-03-15' }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequest when to <= from', async () => {
      await expect(
        service.searchCalendar(
          'test',
          baseQuery({ from: '2026-04-15', to: '2026-04-15' }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('channel not found', () => {
    it('propagates ResourceNotFoundException', async () => {
      channelService.findByIdentifier.mockRejectedValueOnce(
        new ResourceNotFoundException('채널을 찾을 수 없습니다.'),
      );
      await expect(
        service.searchCalendar('nope', baseQuery()),
      ).rejects.toBeInstanceOf(ResourceNotFoundException);
    });
  });

  describe('partial failure', () => {
    it('returns other sources when clips fetch throws', async () => {
      prisma.clipChannel.findMany.mockRejectedValueOnce(new Error('DB 실패'));
      prisma.channelSchedule.findMany.mockResolvedValueOnce([
        {
          id: 100,
          title: '테스트 일정',
          content: null,
          location: null,
          startAt: new Date('2026-04-10T12:00:00.000Z'),
        },
      ]);

      const result = await service.searchCalendar('test', baseQuery());

      expect(result.items.filter((i) => i.type === 'CLIP')).toEqual([]);
      expect(result.items.filter((i) => i.type === 'SCHEDULE')).toHaveLength(1);
    });
  });

  describe('schedule visibility', () => {
    it('includes PRIVATE schedules for owner (no visibility filter)', async () => {
      await service.searchCalendar('test', baseQuery(), 7);
      const arg = prisma.channelSchedule.findMany.mock.calls[0][0];
      expect(arg.where.visibility).toBeUndefined();
    });

    it('restricts to PUBLIC for non-owner non-manager', async () => {
      prisma.channelManager.findUnique.mockResolvedValueOnce(null);
      await service.searchCalendar('test', baseQuery(), 99);
      const arg = prisma.channelSchedule.findMany.mock.calls[0][0];
      expect(arg.where.visibility).toBe('PUBLIC');
    });

    it('restricts to PUBLIC for unauthenticated user', async () => {
      await service.searchCalendar('test', baseQuery());
      const arg = prisma.channelSchedule.findMany.mock.calls[0][0];
      expect(arg.where.visibility).toBe('PUBLIC');
    });
  });

  describe('setlist delegation', () => {
    it('calls searchPublicSetlists with term and parsed range', async () => {
      await service.searchCalendar('test', baseQuery());
      expect(sessionService.searchPublicSetlists).toHaveBeenCalledTimes(1);
      const [identifier, term, range] =
        sessionService.searchPublicSetlists.mock.calls[0];
      expect(identifier).toBe('test');
      expect(term).toBe('테스트');
      expect(range.from).toBeInstanceOf(Date);
      expect(range.to).toBeInstanceOf(Date);
      expect(range.from.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    });
  });

  describe('per-type cap', () => {
    it('caps each type to limit but reports full total', async () => {
      const rows = Array.from({ length: 5 }, (_, i) => ({
        id: i + 1,
        title: `테스트 ${i}`,
        content: null,
        location: null,
        startAt: new Date(`2026-04-1${i}T12:00:00.000Z`),
      }));
      prisma.channelSchedule.findMany.mockResolvedValueOnce(rows);

      const result = await service.searchCalendar(
        'test',
        baseQuery({ limit: 2 }),
      );

      expect(result.total).toBe(5);
      expect(result.items).toHaveLength(2);
    });

    it('does not let a dominant type crowd out other types', async () => {
      // 25개의 (최신) 일정 + 1개의 (더 과거) 클립.
      // 타입별 상한(default 20)이 없으면 클립이 일정에 밀려날 수 있다.
      const schedules = Array.from({ length: 25 }, (_, i) => ({
        id: i + 1,
        title: `테스트 일정 ${i}`,
        content: null,
        location: null,
        startAt: new Date(`2026-05-${String((i % 28) + 1).padStart(2, '0')}T12:00:00.000Z`),
      }));
      prisma.channelSchedule.findMany.mockResolvedValueOnce(schedules);
      prisma.clipChannel.findMany.mockResolvedValueOnce([
        {
          id: 1,
          isPrimary: true,
          createdAt: new Date('2026-04-01T05:00:00.000Z'),
          clip: {
            id: 900,
            title: '테스트 클립',
            createdAt: new Date('2026-04-01T05:00:00.000Z'),
          },
          song: { title: '테스트 곡' },
        },
      ]);

      const result = await service.searchCalendar('test', baseQuery());

      const schedItems = result.items.filter((i) => i.type === 'SCHEDULE');
      const clipItems = result.items.filter((i) => i.type === 'CLIP');
      expect(result.total).toBe(26);
      // 일정은 상한(20)으로 제한
      expect(schedItems).toHaveLength(20);
      // 클립은 일정이 많아도 항상 노출
      expect(clipItems).toHaveLength(1);
    });
  });
});
