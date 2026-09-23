import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { PostStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelService } from './channel.service';
import { SessionService } from '../song-live/session.service';
import { ResourceNotFoundException } from '../common/exceptions/custom.exception';
import {
  expandBirthdayInRange,
  expandMilestonesInRange,
} from './utils/channel-anniversary-range.utils';
import {
  CalendarAnniversaryDto,
  CalendarBroadcastDto,
  CalendarClipDto,
  ChannelCalendarResponseDto,
} from './dto/channel-calendar.response.dto';
import { ChannelCalendarQueryDto } from './dto/channel-calendar.query.dto';
import { CalendarSearchQueryDto } from './dto/channel-calendar-search.query.dto';
import {
  CalendarSearchItemDto,
  CalendarSearchResponseDto,
} from './dto/channel-calendar-search.response.dto';
import { ScheduleResponseDto } from '../schedule/dto/schedule.response.dto';
import { PublicSetlistSummaryDto } from '../song-live/dto/response/public-setlist.response.dto';
import { toScheduleResponse } from '../schedule/mappers/schedule.mapper';

/**
 * 채널 통합 캘린더 (Task 1.7) 서비스.
 *
 * 5 종 데이터 소스 (schedules / broadcasts / setlists / anniversaries / clips) 를
 * `Promise.allSettled` 병렬 fetch 하여 한 응답으로 묶어낸다. 일부 source 가
 * 실패해도 다른 source 는 정상 반환하도록 부분 실패 허용 (실패는 error
 * 로그 기록 후 빈 배열 fallback).
 *
 * - window cap: 13 개월. anniversary util 의 cap-free 호출을 이 entry 에서
 *   보호 (Task 1.6 코드 리뷰 권고).
 * - 캐시: 비로그인 (혹은 PRIVATE schedule 미포함 케이스) 응답은 60초 redis 캐시.
 *   currentUserId 가 있으면 PRIVATE schedule 을 포함할 수 있으므로 캐시 X.
 * - 비-anniversary 소스 실패는 `Logger.error` 로 기록.
 */
@Injectable()
export class ChannelCalendarService {
  private readonly logger = new Logger(ChannelCalendarService.name);

  /**
   * 최대 range cap. 13 개월 ≈ 31 일 * 13 = 403 일 (fixed-day 단순화).
   *
   * 정확한 month-anchored 13 개월 검증이 아닌 fixed-day 상수로 단순화 — 사용자에게
   * 노출되는 메시지도 "최대 403일 (~13개월)" 로 명시. anniversary util cap-free
   * 호출 보호용.
   */
  static readonly MAX_RANGE_MS_403D = 403 * 24 * 60 * 60 * 1000;

  /** @deprecated 기존 호출자 호환용 alias. 신규 코드는 `MAX_RANGE_MS_403D` 사용. */
  static readonly MAX_RANGE_MS = 403 * 24 * 60 * 60 * 1000;

  /** Redis 캐시 TTL (ms). 60 초. */
  static readonly CACHE_TTL_MS = 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly channelService: ChannelService,
    private readonly sessionService: SessionService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async getCalendar(
    identifier: string,
    query: ChannelCalendarQueryDto,
    currentUserId?: number,
  ): Promise<ChannelCalendarResponseDto> {
    // 1. 채널 조회 (id 또는 webPath 자동).
    // findByIdentifier 는 매칭이 없으면 ResourceNotFoundException 을 throw 하므로
    // null check 는 방어적 추가 — 실 환경에선 throw 가 먼저 일어난다.
    const channel = await this.channelService.findByIdentifier(identifier);
    if (!channel) {
      throw new ResourceNotFoundException('채널을 찾을 수 없습니다.');
    }

    // 2. window 검증 — half-open `[from, to)`, to > from, range <= 13 months
    const { fromDate, toDate } = this.parseAndValidateWindow(
      query.from,
      query.to,
    );

    const includeSchedules = query.includeSchedules !== false;
    const includeBroadcasts = query.includeBroadcasts !== false;
    const includeSetlists = query.includeSetlists !== false;
    const includeAnniversaries = query.includeAnniversaries !== false;
    const includeClips = query.includeClips !== false;

    // 3. 캐시 키 (currentUserId 가 있으면 PRIVATE schedule 분기 가능 → 캐시 X)
    const cacheKey = currentUserId
      ? null
      : this.buildCacheKey(channel.id, query, {
          includeSchedules,
          includeBroadcasts,
          includeSetlists,
          includeAnniversaries,
          includeClips,
        });

    if (cacheKey) {
      try {
        const cached =
          await this.cacheManager.get<ChannelCalendarResponseDto>(cacheKey);
        if (cached) {
          return cached;
        }
      } catch (e) {
        // 캐시 read 실패 시 계속 진행 — degraded mode
        this.logger.warn(
          `cache get failed for ${cacheKey}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    // 4. 5 종 병렬 fetch (Promise.allSettled — 부분 실패 허용)
    const [
      schedulesResult,
      broadcastsResult,
      setlistsResult,
      anniversariesResult,
      clipsResult,
    ] = await Promise.allSettled([
      includeSchedules
        ? this.fetchSchedules(channel.id, fromDate, toDate, currentUserId)
        : Promise.resolve([] as ScheduleResponseDto[]),
      includeBroadcasts
        ? this.fetchBroadcasts()
        : Promise.resolve([] as CalendarBroadcastDto[]),
      includeSetlists
        ? this.fetchSetlists(identifier, fromDate, toDate)
        : Promise.resolve([] as PublicSetlistSummaryDto[]),
      includeAnniversaries
        ? this.fetchAnniversaries(channel, fromDate, toDate)
        : Promise.resolve([] as CalendarAnniversaryDto[]),
      includeClips
        ? this.fetchClips(channel.id, fromDate, toDate)
        : Promise.resolve([] as CalendarClipDto[]),
    ]);

    // 5. 응답 조립 — 실패한 source 는 error 로그 + 빈 배열 fallback
    const schedules = this.unwrap(schedulesResult, 'schedules');
    const broadcasts = this.unwrap(broadcastsResult, 'broadcasts');
    const setlists = this.unwrap(setlistsResult, 'setlists');
    const anniversaries = this.unwrap(anniversariesResult, 'anniversaries');
    const clips = this.unwrap(clipsResult, 'clips');

    const response: ChannelCalendarResponseDto = {
      channelId: String(channel.id),
      range: { from: query.from, to: query.to },
      schedules,
      broadcasts,
      setlists,
      anniversaries,
      clips,
    };

    // 6. 캐시 set (60 초)
    if (cacheKey) {
      try {
        await this.cacheManager.set(
          cacheKey,
          response,
          ChannelCalendarService.CACHE_TTL_MS,
        );
      } catch (e) {
        // 캐시 write 실패 시 응답은 이미 만들어졌으니 silent — log only
        this.logger.warn(
          `cache set failed for ${cacheKey}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    return response;
  }

  /**
   * 채널 통합 캘린더 검색 — 5 종 데이터 소스를 키워드로 검색하여 하나의 flat
   * 리스트로 병합한다. `getCalendar` 와 동일한 window 검증(13개월 cap) / 부분 실패
   * 허용(`Promise.allSettled` + `unwrap`) 정책을 따른다.
   *
   * 각 소스의 매칭 대상:
   *   - 일정: title / content / location (DB `contains`)
   *   - 방송 기록: 종료된 source 계약에 따라 항상 빈 결과
   *   - 노래 방송: 곡 제목 / 아티스트 (SessionService.searchPublicSetlists)
   *   - 클립: clip.title / song.title (DB `contains`)
   *   - 기념일: 표시명 (자동 expansion 후 in-memory 필터)
   *
   * 병합 결과는 `date` DESC 정렬 후 `limit` (default 50) 상한 적용. 검색은 q-key
   * 캐시 적중률이 낮고 PRIVATE 일정 분기가 있어 캐시하지 않는다.
   */
  async searchCalendar(
    identifier: string,
    query: CalendarSearchQueryDto,
    currentUserId?: number,
  ): Promise<CalendarSearchResponseDto> {
    const channel = await this.channelService.findByIdentifier(identifier);
    if (!channel) {
      throw new ResourceNotFoundException('채널을 찾을 수 없습니다.');
    }

    const { fromDate, toDate } = this.parseAndValidateWindow(
      query.from,
      query.to,
    );

    const term = (query.q ?? '').trim();
    const baseResponse = {
      channelId: String(channel.id),
      query: query.q ?? '',
      range: { from: query.from, to: query.to },
    };
    if (term.length === 0) {
      return { ...baseResponse, total: 0, items: [] };
    }

    // 타입별 상한 — 한 종류(특히 일정)가 결과를 독식해 다른 타입을 밀어내지
    // 않도록 각 타입을 최대 perType 개까지만 담는다. default 20, query.limit 로 조정 가능(max 50).
    const perType =
      query.limit && query.limit > 0 ? Math.min(query.limit, 50) : 20;

    const includeSchedules = query.includeSchedules !== false;
    const includeBroadcasts = query.includeBroadcasts !== false;
    const includeSetlists = query.includeSetlists !== false;
    const includeAnniversaries = query.includeAnniversaries !== false;
    const includeClips = query.includeClips !== false;

    const [
      schedulesResult,
      broadcastsResult,
      setlistsResult,
      anniversariesResult,
      clipsResult,
    ] = await Promise.allSettled([
      includeSchedules
        ? this.searchSchedules(
            channel.id,
            fromDate,
            toDate,
            term,
            currentUserId,
          )
        : Promise.resolve([] as CalendarSearchItemDto[]),
      includeBroadcasts
        ? this.searchBroadcasts()
        : Promise.resolve([] as CalendarSearchItemDto[]),
      includeSetlists
        ? this.searchSetlists(identifier, fromDate, toDate, term)
        : Promise.resolve([] as CalendarSearchItemDto[]),
      includeAnniversaries
        ? this.searchAnniversaries(channel, fromDate, toDate, term)
        : Promise.resolve([] as CalendarSearchItemDto[]),
      includeClips
        ? this.searchClips(channel.id, fromDate, toDate, term)
        : Promise.resolve([] as CalendarSearchItemDto[]),
    ]);

    const merged: CalendarSearchItemDto[] = [
      ...this.unwrap(schedulesResult, 'search:schedules'),
      ...this.unwrap(broadcastsResult, 'search:broadcasts'),
      ...this.unwrap(setlistsResult, 'search:setlists'),
      ...this.unwrap(anniversariesResult, 'search:anniversaries'),
      ...this.unwrap(clipsResult, 'search:clips'),
    ];

    // date DESC 정렬 (신규 → 과거). ISO8601 문자열은 사전식 정렬이 시간순과 일치.
    merged.sort((a, b) => b.date.localeCompare(a.date));

    // 타입별 상한 적용 — 각 타입에서 최신 perType 개만 남겨, 일정이 많아도
    // 클립/노래방송/기념일이 결과에 항상 노출되도록 한다.
    const countByType = new Map<string, number>();
    const items: CalendarSearchItemDto[] = [];
    for (const it of merged) {
      const n = countByType.get(it.type) ?? 0;
      if (n >= perType) continue;
      countByType.set(it.type, n + 1);
      items.push(it);
    }

    return {
      ...baseResponse,
      total: merged.length,
      items,
    };
  }

  /**
   * 일정 검색 — title / content / location 부분 일치. 날짜 overlap 은
   * `fetchSchedules` 와 동일한 half-open `[from, to)` 규칙. visibility 분기도
   * 동일 (`resolveIncludePrivate`).
   */
  private async searchSchedules(
    channelId: number,
    from: Date,
    to: Date,
    term: string,
    currentUserId?: number,
  ): Promise<CalendarSearchItemDto[]> {
    const includePrivate = await this.resolveIncludePrivate(
      channelId,
      currentUserId,
    );

    const rows = await this.prisma.channelSchedule.findMany({
      where: {
        channelId,
        isDeleted: false,
        // owner/매니저가 아니면 PUBLIC 만.
        ...(includePrivate ? {} : { visibility: 'PUBLIC' as const }),
        AND: [
          {
            // half-open `[from, to)` overlap — fetchSchedules 와 동일.
            OR: [
              { AND: [{ startAt: { lt: to } }, { endAt: { gte: from } }] },
              { AND: [{ startAt: { gte: from, lt: to } }, { endAt: null }] },
            ],
          },
          {
            OR: [
              { title: { contains: term } },
              { content: { contains: term } },
              { location: { contains: term } },
            ],
          },
        ],
      },
      orderBy: { startAt: 'desc' },
      take: 100,
      select: {
        id: true,
        title: true,
        content: true,
        location: true,
        startAt: true,
      },
    });

    return rows.map(
      (r): CalendarSearchItemDto => ({
        type: 'SCHEDULE',
        date: r.startAt.toISOString(),
        title: r.title,
        subtitle: r.location ?? this.snippet(r.content),
        scheduleId: r.id,
        sessionKey: null,
        sessionId: null,
        clipId: null,
        anniversaryType: null,
      }),
    );
  }

  /**
   * 방송 기록 검색 — 종료된 source의 fail-open 계약에 따라 빈 결과를 유지한다.
   */
  private searchBroadcasts(): Promise<CalendarSearchItemDto[]> {
    return Promise.resolve([] as CalendarSearchItemDto[]);
  }

  /**
   * 노래 방송 검색 — SessionService.searchPublicSetlists 위임 (곡 제목/아티스트
   * 매칭). 매칭된 대표 곡 제목을 title 로, "노래 방송 · N곡" 을 subtitle 로.
   */
  private async searchSetlists(
    identifier: string,
    from: Date,
    to: Date,
    term: string,
  ): Promise<CalendarSearchItemDto[]> {
    const results = await this.sessionService.searchPublicSetlists(
      identifier,
      term,
      { from, to },
      50,
    );
    return results.map(
      ({ summary, matchedSongTitle }): CalendarSearchItemDto => ({
        type: 'SETLIST',
        date: summary.startedAt,
        title: matchedSongTitle ?? '노래 방송',
        subtitle: `노래 방송 · ${summary.completedCount}곡`,
        scheduleId: null,
        sessionKey: summary.sessionKey,
        sessionId: summary.sessionId,
        clipId: null,
        anniversaryType: null,
      }),
    );
  }

  /**
   * 기념일 검색 — 자동 expansion (`fetchAnniversaries`) 후 표시명 in-memory 필터.
   */
  private async searchAnniversaries(
    channel: { id: number },
    from: Date,
    to: Date,
    term: string,
  ): Promise<CalendarSearchItemDto[]> {
    const anniversaries = await this.fetchAnniversaries(channel, from, to);
    const lower = term.toLowerCase();
    return anniversaries
      .filter((a) => a.title.toLowerCase().includes(lower))
      .map(
        (a): CalendarSearchItemDto => ({
          type: 'ANNIVERSARY',
          date: a.date,
          title: a.title,
          subtitle: a.type === 'BIRTHDAY' ? '생일' : '기념일',
          scheduleId: null,
          sessionKey: null,
          sessionId: null,
          clipId: null,
          anniversaryType: a.type,
        }),
      );
  }

  /**
   * 클립 검색 — clip.title / song.title 부분 일치. 날짜 기준은 `fetchClips` 와
   * 동일한 clip.createdAt half-open `[from, to)`, VISIBLE + deletedAt null.
   */
  private async searchClips(
    channelId: number,
    from: Date,
    to: Date,
    term: string,
  ): Promise<CalendarSearchItemDto[]> {
    const clipChannels = await this.prisma.clipChannel.findMany({
      where: {
        channelId,
        clip: {
          status: PostStatus.VISIBLE,
          deletedAt: null,
          createdAt: { gte: from, lt: to },
        },
        OR: [
          { clip: { is: { title: { contains: term } } } },
          { song: { is: { title: { contains: term } } } },
        ],
      },
      include: {
        clip: true,
        song: { select: { title: true } },
      },
      orderBy: { clip: { createdAt: 'desc' } },
      take: 100,
    });

    return clipChannels.map(
      (cc): CalendarSearchItemDto => ({
        type: 'CLIP',
        date: (cc.clip.createdAt ?? cc.createdAt).toISOString(),
        title: cc.clip.title,
        subtitle: cc.song?.title ?? null,
        scheduleId: null,
        sessionKey: null,
        sessionId: null,
        clipId: cc.clip.id,
        anniversaryType: null,
      }),
    );
  }

  /**
   * 텍스트 스니펫 — content 같은 긴 본문을 검색 결과 subtitle 용으로 자른다.
   */
  private snippet(text: string | null, max = 60): string | null {
    if (!text) return null;
    const t = text.trim();
    if (!t) return null;
    return t.length > max ? `${t.slice(0, max)}...` : t;
  }

  /**
   * from/to 문자열 파싱 + window 검증 (half-open `[from, to)`, to > from,
   * range <= 403일(~13개월)). `getCalendar` / `searchCalendar` 공유.
   */
  private parseAndValidateWindow(
    from: string,
    to: string,
  ): { fromDate: Date; toDate: Date } {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (Number.isNaN(fromDate.getTime())) {
      throw new BadRequestException('from 은 ISO8601 형식이어야 합니다.');
    }
    if (Number.isNaN(toDate.getTime())) {
      throw new BadRequestException('to 는 ISO8601 형식이어야 합니다.');
    }
    if (toDate.getTime() <= fromDate.getTime()) {
      throw new BadRequestException('to 는 from 보다 커야 합니다.');
    }
    if (
      toDate.getTime() - fromDate.getTime() >
      ChannelCalendarService.MAX_RANGE_MS_403D
    ) {
      throw new BadRequestException(
        'range 는 최대 403일 (~13개월) 까지만 허용합니다.',
      );
    }
    return { fromDate, toDate };
  }

  /**
   * PRIVATE 일정 포함 여부 — currentUserId 가 채널 owner 이거나 active manager 면
   * true. `fetchSchedules` / `searchSchedules` 공유 (visibility 분기 drift 방지).
   */
  private async resolveIncludePrivate(
    channelId: number,
    currentUserId?: number,
  ): Promise<boolean> {
    if (!currentUserId) return false;
    const owner = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { userId: true },
    });
    if (owner?.userId === currentUserId) return true;
    const mgr = await this.prisma.channelManager.findUnique({
      where: { channelId_userId: { channelId, userId: currentUserId } },
      select: { isActive: true },
    });
    return !!mgr?.isActive;
  }

  /**
   * `Promise.allSettled` 결과 unwrapper. fulfilled → value, rejected → 빈 배열 + error 로그.
   *
   * 부분 실패 정책 — schedules / broadcasts / setlists / anniversaries 중 하나가
   * 실패해도 다른 데이터는 정상 반환. error 는 silent 가 아니라 `Logger.error` 로 기록.
   */
  private unwrap<T>(
    result: PromiseSettledResult<T[]>,
    sourceLabel: string,
  ): T[] {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    const reason = result.reason;
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : (() => {
              try {
                return JSON.stringify(reason);
              } catch {
                return 'unknown error';
              }
            })();
    this.logger.error(
      `unified-calendar ${sourceLabel} fetch failed — falling back to empty: ${message}`,
    );
    return [];
  }

  /**
   * 채널 일정 조회. PUBLIC 만 기본, currentUserId 가 본인/매니저면 PRIVATE 도 포함.
   *
   * `ScheduleService.listChannelPublic` 에 위임할 수도 있지만 그쪽은 pagination
   * 컨벤션 (page/limit 100 기본) 을 강제하므로, 캘린더용으로는 prisma 직접 호출이
   * 더 단순하고 정확하다. 일정 도메인의 visibility 분기 로직은 동일하게 복제.
   *
   * ⚠ visibility 분기 (owner / active manager / PUBLIC fallback) 는
   *    `ScheduleService.listChannelPublic` 와 의도적 중복.
   *    변경 시 양쪽 동기화 필요. 향후 `resolveScheduleVisibility(channelId, userId)`
   *    같은 공통 util 추출 검토 (drift 위험 줄이기 위해).
   */
  private async fetchSchedules(
    channelId: number,
    from: Date,
    to: Date,
    currentUserId?: number,
  ): Promise<ScheduleResponseDto[]> {
    const includePrivate = await this.resolveIncludePrivate(
      channelId,
      currentUserId,
    );

    const where: Record<string, unknown> = {
      channelId,
      isDeleted: false,
      // half-open `[from, to)` overlap (schedule 의 [startAt, endAt or startAt])
      OR: [
        {
          AND: [{ startAt: { lt: to } }, { endAt: { gte: from } }],
        },
        {
          AND: [{ startAt: { gte: from, lt: to } }, { endAt: null }],
        },
      ],
    };
    if (!includePrivate) {
      where.visibility = 'PUBLIC';
    }

    const rows = await this.prisma.channelSchedule.findMany({
      where,
      orderBy: { startAt: 'asc' },
      // 캘린더는 한 페이지에 모두 표시하므로 충분히 큰 take. 13 개월 cap 으로 보호됨.
      take: 500,
      include: {
        author: {
          select: { id: true, nickname: true, profileImageUrl: true },
        },
        channel: {
          select: {
            id: true,
            name: true,
            profileImageUrl: true,
            webPath: true,
            user: {
              select: {
                isProSubscriber: true,
                proSubscriptionEndAt: true,
                isAmbassador: true,
              },
            },
          },
        },
      },
    });

    return rows.map((r) => toScheduleResponse(r));
  }

  /**
   * 방송 기록 조회.
   *
   * ranking-back 종료 후에도 캘린더 계약은 유지한다. 종료 직전 운영에서
   * ranking-back 장애 시 반환하던 fail-open 값과 동일하게 빈 목록을 반환하며,
   * 외부 호출이나 ranking 전용 설정에 의존하지 않는다.
   */
  private fetchBroadcasts(): Promise<CalendarBroadcastDto[]> {
    return Promise.resolve([] as CalendarBroadcastDto[]);
  }

  /**
   * 셋리스트 조회. SessionService.getPublicSetlists 에 위임 (Task 1.4 의 from/to 추가).
   *
   * 캘린더는 단일 페이지 — limit 을 충분히 크게 (50, server-cap 일치) 받아 모두 표시.
   * SessionService 측에서 90 일 상한이 걸려 있으니, 13 개월 요청이 들어오면
   * BadRequest 가 그대로 surface 된다. 상위 service 의 13 개월 cap 검증 이후에도
   * setlists 만 90 일 cap 인 점은 의도된 mismatch — 셋리스트 서비스를 13 개월로
   * 늘리는 건 Task 1.4 범위 외.
   *
   * 따라서 13 개월 cap (캘린더 entry) 와 90 일 cap (setlists) 사이의 갭에
   * 떨어지는 (90 일 < range <= 13 개월) 요청은 setlists fetch 가 BadRequest 로
   * 떨어진다. 이 경우는 `unwrap` 의 fallback 으로 빈 배열 + 로그 처리되어
   * 다른 source 는 정상 반환된다.
   *
   * 운영상 이 mismatch 가 문제되면 setlists 측 cap 을 13 개월로 확장하는 것이
   * 근본 해결 — Task 1.4 코드 리뷰 follow-up 으로 남긴다.
   */
  private async fetchSetlists(
    identifier: string,
    from: Date,
    to: Date,
  ): Promise<PublicSetlistSummaryDto[]> {
    const fromIso = from.toISOString();
    const toIso = to.toISOString();

    // 90 일 cap 초과 시 SessionService 가 BadRequest 를 던진다 — 캘린더가 13 개월
    // 까지 받는 경우 setlists 만 빈 배열로 fallback 시키기 위해 lookup 전에 분기.
    const SETLISTS_MAX_RANGE_MS = 90 * 24 * 60 * 60 * 1000;
    if (to.getTime() - from.getTime() > SETLISTS_MAX_RANGE_MS) {
      this.logger.warn(
        `unified-calendar setlists range > 90 days (${(to.getTime() - from.getTime()) / 86400000}d) — skipping setlists fetch`,
      );
      return [];
    }

    const result = await this.sessionService.getPublicSetlists(
      identifier,
      1,
      50,
      { from: fromIso, to: toIso },
    );
    return result.setlists;
  }

  /**
   * 자동 기념일 (BIRTHDAY / BROADCAST_MILESTONE) 계산.
   *
   * profile 의 debutDate (100일 / N주년) 와 birthday 를 from~to 범위 내에서
   * 모두 expand. Phase 2 에서 ChannelAnniversary 테이블을 추가하면 여기에 머지.
   *
   * 13 개월 cap 은 service entry 에서 이미 검증되었으므로 util 에 그대로 위임 안전.
   */
  private async fetchAnniversaries(
    channel: { id: number },
    from: Date,
    to: Date,
  ): Promise<CalendarAnniversaryDto[]> {
    const profile = await this.prisma.channelProfile.findUnique({
      where: { channelId: channel.id },
      select: { birthday: true, debutDate: true },
    });
    if (!profile) {
      return [];
    }

    const items: CalendarAnniversaryDto[] = [];

    if (profile.debutDate) {
      const milestones = expandMilestonesInRange(profile.debutDate, from, to);
      for (const m of milestones) {
        items.push({
          id: null,
          source: 'AUTO',
          type: 'BROADCAST_MILESTONE',
          title: m.title,
          date: m.date.toISOString(),
        });
      }
    }

    if (profile.birthday) {
      const birthdays = expandBirthdayInRange(profile.birthday, from, to);
      for (const b of birthdays) {
        items.push({
          id: null,
          source: 'AUTO',
          type: 'BIRTHDAY',
          title: b.title,
          date: b.date.toISOString(),
        });
      }
    }

    // 날짜 오름차순 정렬 (같은 날 BIRTHDAY 가 BROADCAST_MILESTONE 보다 먼저 와도 무방)
    items.sort((a, b) => a.date.localeCompare(b.date));

    return items;
  }

  /**
   * 노래 클립 조회. ClipChannel 중간 테이블을 통해 채널이 메인/출연으로 연결된
   * VISIBLE 클립을 createdAt 기준 [from, to) 로 필터링하여 반환.
   *
   * 캘린더 표시 기준은 `Clip.createdAt` (등록 시점). half-open `[from, to)` —
   * `gte from` + `lt to`. status 는 VISIBLE 만, deletedAt 은 null 만.
   *
   * 정렬은 `clip.createdAt DESC`. 한 채널 한 번의 캘린더 호출에 13 개월 cap 이
   * 걸려 있으니 상한 take 200 으로 단순 제한 (broadcasts 합본 50 * N 개 와 비슷한 룰).
   *
   * 듀엣/단체곡: 한 클립이 여러 ClipChannel 로 연결될 수 있으나, 본 채널
   * 시점에서 보면 항상 1 개 ClipChannel row 만 존재 (uq_clip_channel) — 따라서
   * isPrimary / songTitle 은 row 단위로 그대로 매핑하면 된다.
   */
  private async fetchClips(
    channelId: number,
    from: Date,
    to: Date,
  ): Promise<CalendarClipDto[]> {
    const clipChannels = await this.prisma.clipChannel.findMany({
      where: {
        channelId,
        clip: {
          status: PostStatus.VISIBLE,
          deletedAt: null,
          createdAt: { gte: from, lt: to },
        },
      },
      include: {
        clip: true,
        song: { select: { title: true } },
      },
      orderBy: { clip: { createdAt: 'desc' } },
      take: 200,
    });

    return clipChannels.map((cc) => ({
      id: cc.clip.id,
      title: cc.clip.title,
      platform: cc.clip.platform,
      videoId: cc.clip.videoId,
      videoUrl: cc.clip.videoUrl,
      thumbnailUrl: cc.clip.thumbnailUrl,
      duration: cc.clip.duration,
      // Clip.createdAt 은 schema 상 nullable (DateTime? @default(now())) 이지만
      // 실 row 는 항상 default(now()) 로 채워진다. 방어적으로 null 일 경우
      // empty string 대신 ClipChannel.createdAt 으로 fallback (둘 다 사실상 동등).
      createdAt: (cc.clip.createdAt ?? cc.createdAt).toISOString(),
      isPrimary: cc.isPrimary,
      songTitle: cc.song?.title ?? null,
    }));
  }

  /**
   * 캐시 키 빌더. include 플래그 5 종을 모두 키에 반영하여 부분 fetch 모드의
   * 캐시 충돌을 방지. PRIVATE schedule 분기를 위해 currentUserId 가 있는 경우는
   * 호출자에서 캐시 자체를 비활성화한다.
   */
  private buildCacheKey(
    channelId: number,
    query: ChannelCalendarQueryDto,
    flags: {
      includeSchedules: boolean;
      includeBroadcasts: boolean;
      includeSetlists: boolean;
      includeAnniversaries: boolean;
      includeClips: boolean;
    },
  ): string {
    return [
      'cal',
      channelId,
      query.from,
      query.to,
      flags.includeSchedules ? 's1' : 's0',
      flags.includeBroadcasts ? 'b1' : 'b0',
      flags.includeSetlists ? 'l1' : 'l0',
      flags.includeAnniversaries ? 'a1' : 'a0',
      flags.includeClips ? 'c1' : 'c0',
    ].join(':');
  }
}
