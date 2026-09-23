import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  ResourceNotFoundException,
  InvalidInputException,
} from '../common/exceptions/custom.exception';
import { UnauthorizedException } from '@nestjs/common';
import {
  LiveSessionStatus,
  LiveSessionType,
  LiveSessionExtractStatus,
  StreamPlatform,
  SongRequestStatus,
  SongRequestSource,
  KaraokePlaybackMode,
  KaraokeVideoType,
  ChannelVerificationStatus,
  ScheduleVisibility,
  SongRequestMode,
  PostStatus,
} from '@prisma/client';
import {
  liveSessionWithSettingsSelect,
  LiveSessionWithSettings,
} from './prisma/song-live.selections';
import { StartSessionDto } from './dto/request/start-session.dto';
import { UpdateSettingsDto } from './dto/request/update-settings.dto';
import { LyricsPlaybackStateDto } from './dto/request/lyrics-playback-state.dto';
import { CreateManualRequestDto } from './dto/request/create-manual-request.dto';
import { ChzzkChatService } from './chat/chzzk/chzzk-chat.service';
import { SoopChatService } from './chat/soop/soop-chat.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomBytes } from 'crypto';
import { ChannelService } from '../channel/channel.service';
import { ChannelSongRequestSettingsService } from '../channel/channel-song-request-settings.service';
import { ChannelSongRequestSettingsNotifierService } from '../channel/channel-song-request-settings-notifier.service';
import { SongRequestQueueService } from '../song-request/song-request-queue.service';
import { MetricsService } from '../metrics';
import {
  EffectiveSongRequestSettings,
  mergeEffectiveSongRequestSettings,
} from './effective-song-request-settings';
import { PublicSetlistSummaryDto } from './dto/response/public-setlist.response.dto';
import { enqueuePlaybackRevision } from '../overlay-playback/bump-playback-revision';

/**
 * 신청곡 라이브 세션 서비스
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chzzkChatService: ChzzkChatService,
    private readonly soopChatService: SoopChatService,
    private readonly eventEmitter: EventEmitter2,
    private readonly channelService: ChannelService,
    private readonly songRequestQueueService: SongRequestQueueService,
    private readonly metricsService: MetricsService,
    private readonly configService: ConfigService,
    private readonly channelSongRequestSettingsService: ChannelSongRequestSettingsService,
    private readonly channelSongRequestSettingsNotifier: ChannelSongRequestSettingsNotifierService,
  ) {}

  /**
   * LiveSession + LiveSessionSettings select 응답에 ChannelSongRequestSettings 를
   * merge 해서 settings 필드를 EffectiveSongRequestSettings 로 덮어쓴 응답 반환.
   *
   * 호출자는 응답의 `settings.X` 접근을 그대로 유지하되, 채널-scope 필드는
   * ChannelSongRequestSettings 가 source of truth. LiveSessionSettings 의 stale 컬럼은
   * cleanup 단계까지 잔류하지만 응답에 노출되지 X.
   */
  private async withEffectiveSettings<
    T extends {
      channelId: number;
      settings: {
        requestEnabled: boolean;
        paused: boolean;
      } | null;
    },
  >(session: T): Promise<T & { settings: T['settings'] & EffectiveSongRequestSettings }> {
    const channelSettings =
      await this.channelSongRequestSettingsService.getByChannelId(
        session.channelId,
      );
    const effective = mergeEffectiveSongRequestSettings(
      session.settings,
      channelSettings,
    );
    return {
      ...session,
      settings: { ...(session.settings ?? {}), ...effective },
    } as T & { settings: T['settings'] & EffectiveSongRequestSettings };
  }

  private async notifyDispatcher(payload: object): Promise<void> {
    const webhookUrl = this.configService.get<string>(
      'CHAT_DISPATCHER_WEBHOOK_URL',
    );
    if (!webhookUrl) return;

    const apiKey = this.configService.get<string>('INTERNAL_API_KEY');
    const response = await fetch(`${webhookUrl}/internal/session-events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Api-Key': apiKey ?? '',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) {
      throw new Error(`Dispatcher webhook returned ${response.status}`);
    }
  }

  /**
   * 채널 소유자 또는 settings 권한 매니저인지 확인
   */
  private async ensureChannelSettingsPermission(
    channelId: number,
    userId: number,
    unauthorizedMessage: string,
  ): Promise<void> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { userId: true },
    });

    if (!channel) {
      throw new ResourceNotFoundException('채널을 찾을 수 없습니다.');
    }

    if (channel.userId === userId) {
      return;
    }

    const manager = await this.channelService.getManagerPermissions(
      channelId,
      userId,
    );
    const canManageAsManager =
      manager?.isActive === true && manager.canManageSettings === true;
    if (!canManageAsManager) {
      throw new UnauthorizedException(unauthorizedMessage);
    }
  }

  private async isChannelSettingsOperator(
    channelId: number,
    userId: number | undefined,
    isAdmin = false,
  ): Promise<boolean> {
    if (!userId) return false;
    if (isAdmin) return true;

    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { userId: true },
    });
    if (!channel) return false;
    if (channel.userId === userId) return true;

    const manager = await this.channelService.getManagerPermissions(
      channelId,
      userId,
    );
    return manager?.isActive === true && manager.canManageSettings === true;
  }

  /**
   * 채널 소유자 또는 canManageContent 매니저인지 확인.
   *
   * 콘텐츠(셋리스트 등)의 가시성을 변경하는 owner 관리 endpoint 에서 사용.
   * settings 권한과는 분리 — settings 매니저라도 content 변경 권한이 없으면 거부.
   */
  private async ensureChannelContentPermission(
    channelId: number,
    userId: number,
    unauthorizedMessage: string,
  ): Promise<void> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { userId: true },
    });

    if (!channel) {
      throw new ResourceNotFoundException('채널을 찾을 수 없습니다.');
    }

    if (channel.userId === userId) {
      return;
    }

    const manager = await this.prisma.channelManager.findUnique({
      where: { channelId_userId: { channelId, userId } },
      select: { isActive: true, canManageContent: true },
    });
    if (!manager?.isActive || !manager.canManageContent) {
      throw new UnauthorizedException(unauthorizedMessage);
    }
  }

  /**
   * 세션 관리 대상 채널 ID를 식별합니다.
   * - identifier 제공 시: 해당 채널 접근 권한(owner/settings manager) 검증
   * - identifier 미제공 시: 기존 호환을 위해 소유 채널의 첫 번째 채널 사용
   */
  async resolveAccessibleChannelId(
    userId: number,
    identifier?: string,
    unauthorizedMessage: string = '세션을 조회할 권한이 없습니다.',
  ): Promise<number | null> {
    if (identifier) {
      const channelId =
        await this.channelService.resolveChannelIdByIdentifier(identifier);
      if (!channelId) {
        throw new ResourceNotFoundException('채널을 찾을 수 없습니다.');
      }
      await this.ensureChannelSettingsPermission(
        channelId,
        userId,
        unauthorizedMessage,
      );
      return channelId;
    }

    const ownedChannel = await this.prisma.channel.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    return ownedChannel?.id ?? null;
  }

  /**
   * 라이브 세션 시작
   */
  async startSession(
    userId: number,
    channelId: number,
    dto: StartSessionDto,
  ): Promise<LiveSessionWithSettings> {
    try {
      const channel = await this.prisma.channel.findUnique({
        where: { id: channelId },
        select: { overlayToken: true },
      });

      if (!channel) {
        throw new ResourceNotFoundException('채널을 찾을 수 없습니다.');
      }

      await this.ensureChannelSettingsPermission(
        channelId,
        userId,
        '세션을 시작할 권한이 없습니다.',
      );

      // 활성 세션이 있는지 확인
      const activeSession = await this.prisma.liveSession.findFirst({
        where: {
          channelId,
          status: LiveSessionStatus.ACTIVE,
          sessionType: LiveSessionType.STANDARD,
        },
      });

      if (activeSession) {
        throw new InvalidInputException(
          '이미 활성화된 라이브 세션이 있습니다.',
        );
      }

      // 승인된 모든 인증 조회 (멀티 플랫폼 지원)
      const approvedVerifications =
        await this.prisma.channelVerification.findMany({
          where: { channelId, status: ChannelVerificationStatus.APPROVED },
          select: { platform: true, platformChannelId: true },
          orderBy: { id: 'asc' },
        });

      const validVerifications = approvedVerifications.filter(
        (v) => v.platformChannelId,
      );
      if (validVerifications.length === 0) {
        throw new InvalidInputException(
          '승인된 플랫폼 인증이 없습니다. 채널 인증을 먼저 완료해주세요.',
        );
      }

      let primary;
      if (dto.platform) {
        primary = validVerifications.find((v) => v.platform === dto.platform);
        // 요청한 플랫폼 인증이 없으면 첫 번째 승인된 인증으로 fallback
        if (!primary) {
          primary = validVerifications[0];
        }
      } else {
        primary = validVerifications[0];
      }

      const platform = primary.platform as StreamPlatform;
      const platformChannelId = primary.platformChannelId;

      // 채널에 overlayToken이 없으면 생성
      let overlayToken = channel.overlayToken;
      if (!overlayToken) {
        overlayToken = randomBytes(32).toString('hex');
        await this.prisma.channel.update({
          where: { id: channelId },
          data: { overlayToken },
        });
      }

      // 채널 단위 settings (ChannelSongRequestSettings) 가 source of truth.
      // 신규 채널의 첫 라이브에서 row 없으면 lazy create 보장 (race condition 방어).
      await this.channelSongRequestSettingsService.getByChannelId(channelId);

      // 트랜잭션으로 세션 + 라이브 한정 상태 생성
      // (LiveSessionSettings 의 채널-scope 컬럼은 prisma schema default 그대로.
      //  응답 시 withEffectiveSettings 가 ChannelSongRequestSettings 로 override.)
      const session = await this.prisma.$transaction(async (tx) => {
        const newSession = await tx.liveSession.create({
          data: {
            channelId,
            userId,
            platform,
            platformChannelId,
            overlayToken, // 채널의 고정 토큰 사용
            status: LiveSessionStatus.ACTIVE,
            sessionType: LiveSessionType.STANDARD,
            visibility:
              dto.practiceMode === true
                ? ScheduleVisibility.PRIVATE
                : ScheduleVisibility.PUBLIC,
          },
          select: liveSessionWithSettingsSelect,
        });

        await tx.liveSessionSettings.create({
          data: {
            liveSessionId: newSession.id,
            requestEnabled: true,
            paused: false,
          },
        });

        // 세션 시작도 snapshot-producing command (GATE 0). 새 세션은 id(=sessionEpoch)
        // 자체가 이전 세션보다 크므로 이미 out-rank 되지만, 일관성을 위해 revision bump.
        await enqueuePlaybackRevision(tx, newSession.id, {
          commandType: 'live_session.started',
        });

        // 설정을 포함한 세션 재조회
        return tx.liveSession.findUnique({
          where: { id: newSession.id },
          select: liveSessionWithSettingsSelect,
        });
      });

      if (!session) {
        throw new Error('세션 생성 후 조회 실패');
      }

      const effectiveSession = await this.withEffectiveSettings(session);

      // 세션 시작 이벤트 발행 (오버레이에 알림)
      this.eventEmitter.emit('live-session.started', {
        overlayToken,
        sessionId: effectiveSession.id,
        settings: effectiveSession.settings,
      });

      this.notifyDispatcher({
        event: 'session.started',
        sessionId: session.id,
        channelId,
        platform: session.platform,
        platformChannelId: session.platformChannelId,
        startedAt: session.startedAt.toISOString(),
      }).catch((err) =>
        this.logger.warn(`Dispatcher webhook failed: ${err?.message}`),
      );

      this.metricsService.liveSessionsStartedTotal.inc({
        platform,
        result: 'success',
      });

      this.logger.log(
        `Live session started: ${session.id} for channel ${channelId}`,
      );

      return effectiveSession;
    } catch (error) {
      this.metricsService.liveSessionsStartedTotal.inc({
        platform: 'unknown',
        result: 'failure',
      });
      throw error;
    }
  }

  /**
   * 활성 세션 조회
   */
  async getActiveSession(
    channelId: number,
    userId: number,
  ): Promise<LiveSessionWithSettings | null> {
    await this.ensureChannelSettingsPermission(
      channelId,
      userId,
      '세션을 조회할 권한이 없습니다.',
    );

    const session = await this.prisma.liveSession.findFirst({
      where: {
        channelId,
        status: LiveSessionStatus.ACTIVE,
        sessionType: LiveSessionType.STANDARD,
      },
      select: liveSessionWithSettingsSelect,
    });
    if (!session) return null;
    return this.withEffectiveSettings(session);
  }

  /**
   * 공개용 활성 세션 조회 (채널 식별자 기준)
   */
  async getPublicActiveSession(
    identifier: string,
    viewerUserId?: number,
    viewerIsAdmin = false,
  ) {
    const channelId =
      await this.channelService.resolveChannelIdByIdentifier(identifier);
    if (!channelId) {
      throw new ResourceNotFoundException('채널을 찾을 수 없습니다.');
    }

    const session = await this.prisma.liveSession.findFirst({
      where: {
        channelId,
        status: LiveSessionStatus.ACTIVE,
        sessionType: LiveSessionType.STANDARD,
        sourcePerformanceId: null,
      },
      include: { settings: true },
    });

    if (!session) {
      return {
        sessionId: null,
        isLive: false,
        settings: null,
        queueCount: 0,
      };
    }

    const isPracticeSession = session.visibility === ScheduleVisibility.PRIVATE;
    if (
      isPracticeSession &&
      !(await this.isChannelSettingsOperator(
        channelId,
        viewerUserId,
        viewerIsAdmin,
      ))
    ) {
      return {
        sessionId: null,
        isLive: false,
        settings: null,
        queueCount: 0,
      };
    }

    const channelSettings =
      await this.channelSongRequestSettingsService.getByChannelId(channelId);
    const effective = mergeEffectiveSongRequestSettings(
      session.settings,
      channelSettings,
    );

    const queueCount = await this.prisma.songRequest.count({
      where: {
        liveSessionId: session.id,
        status: {
          in: [
            SongRequestStatus.PENDING,
            SongRequestStatus.ACCEPTED,
            SongRequestStatus.PLAYING,
          ],
        },
      },
    });

    return {
      sessionId: session.id,
      isLive: true,
      settings: effective,
      queueCount,
      isPracticeMode: isPracticeSession,
    };
  }

  /**
   * 공개용 셋리스트 목록 — 종료된 세션 중 재생 완료된 곡이 1개 이상 있는 세션만.
   * 인증 없음. 채널 페이지의 셋리스트 탭에서 사용.
   *
   * range (`from`/`to`) 가 함께 오면 startedAt 에 half-open `[from, to)` 필터가
   * 적용된다 (채널 통합 캘린더 월별 조회용). 둘 다 없으면 기존 동작과 동일.
   * cross-field 검증 (둘 다 / `to > from` / 90일 상한) 은 여기서 수행한다.
   */
  async getPublicSetlists(
    identifier: string,
    page: number = 1,
    limit: number = 20,
    range?: { from?: string; to?: string },
  ) {
    const channelId =
      await this.channelService.resolveChannelIdByIdentifier(identifier);
    if (!channelId) {
      throw new ResourceNotFoundException('채널을 찾을 수 없습니다.');
    }

    // from/to 쌍 검증 — chat-service `GetBroadcastHistory` 와 동일한 컨벤션.
    const fromStr = range?.from;
    const toStr = range?.to;
    const hasFrom = fromStr !== undefined && fromStr !== null && fromStr !== '';
    const hasTo = toStr !== undefined && toStr !== null && toStr !== '';
    let dateFilter: { gte: Date; lt: Date } | undefined;
    if (hasFrom !== hasTo) {
      throw new BadRequestException(
        'from / to 는 함께 와야 합니다 (둘 중 하나만 있는 요청은 거부).',
      );
    }
    if (hasFrom && hasTo) {
      const fromDate = new Date(fromStr as string);
      const toDate = new Date(toStr as string);
      if (Number.isNaN(fromDate.getTime())) {
        throw new BadRequestException('from 은 RFC 3339 형식이어야 합니다.');
      }
      if (Number.isNaN(toDate.getTime())) {
        throw new BadRequestException('to 는 RFC 3339 형식이어야 합니다.');
      }
      if (toDate.getTime() <= fromDate.getTime()) {
        throw new BadRequestException('to 는 from 보다 커야 합니다.');
      }
      const MAX_RANGE_MS = 90 * 24 * 60 * 60 * 1000;
      if (toDate.getTime() - fromDate.getTime() > MAX_RANGE_MS) {
        throw new BadRequestException('range 는 최대 90일까지만 허용합니다.');
      }
      dateFilter = { gte: fromDate, lt: toDate };
    }

    // 공개 셋리스트는 채널 owner 가 PUBLIC 으로 둔 세션만 노출.
    // PRIVATE 은 owner 의 setlist 관리 페이지에서만 보이고, 공개 페이지/캘린더에선 제외.
    const where = {
      channelId,
      sessionType: LiveSessionType.STANDARD,
      status: LiveSessionStatus.ENDED,
      visibility: 'PUBLIC' as const,
      sourcePerformanceId: null,
      songRequests: {
        some: { status: SongRequestStatus.COMPLETED },
      },
      ...(dateFilter ? { startedAt: dateFilter } : {}),
    } as const;

    const skip = (page - 1) * limit;

    const [sessions, total] = await Promise.all([
      this.prisma.liveSession.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          platform: true,
          platformChannelId: true,
          startedAt: true,
          endedAt: true,
          _count: {
            select: {
              songRequests: {
                where: { status: SongRequestStatus.COMPLETED },
              },
            },
          },
        },
      }),
      this.prisma.liveSession.count({ where }),
    ]);

    const setlists = await this.buildSetlistSummaries(sessions);

    return {
      setlists,
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  /**
   * LiveSession 행 목록 → 공개 셋리스트 요약 DTO 매핑 (앨범아트 미리보기 포함).
   *
   * `getPublicSetlists` (공개 목록) 와 `searchPublicSetlists` (통합 캘린더 검색)
   * 가 동일한 카드 표현을 쓰도록 공유한다. 세션당 distinct 앨범아트 최대 6장을
   * 별도 쿼리로 모아 미리보기로 담는다.
   */
  private async buildSetlistSummaries(
    sessions: Array<{
      id: number;
      platform: StreamPlatform | null;
      platformChannelId: string | null;
      startedAt: Date;
      endedAt: Date | null;
      _count: { songRequests: number };
    }>,
  ): Promise<PublicSetlistSummaryDto[]> {
    // 카드 미리보기용 앨범아트 — 각 세션별 distinct 최대 6장.
    // 세션당 limit 16으로 dedupe 여유분만 읽고, 부족하면 그대로 6장 미만.
    const previewMap = new Map<number, string[]>();
    await Promise.all(
      sessions.map(async (s) => {
        const rows = await this.prisma.songRequest.findMany({
          where: {
            liveSessionId: s.id,
            status: SongRequestStatus.COMPLETED,
          },
          orderBy: [{ playedAt: 'asc' }, { createdAt: 'asc' }],
          take: 16,
          select: {
            song: { select: { albumArt: true, coverUrl: true } },
          },
        });
        const arts: string[] = [];
        for (const row of rows) {
          const art = row.song?.albumArt ?? row.song?.coverUrl ?? null;
          if (!art) continue;
          if (!arts.includes(art)) {
            arts.push(art);
            if (arts.length >= 6) break;
          }
        }
        previewMap.set(s.id, arts);
      }),
    );

    return sessions.map((s) => {
      const startedAtIso = s.startedAt.toISOString();
      // 통합 캘린더에서 broadcasts 응답과 매칭. platform 또는 platformChannelId
      // 가 누락되면 해당 세션은 매칭 대상이 아니므로 null 로 둔다.
      const sessionKey =
        s.platform && s.platformChannelId
          ? `${s.platform}:${s.platformChannelId}:${startedAtIso}`
          : null;
      return {
        sessionId: s.id,
        platform: s.platform,
        platformChannelId: s.platformChannelId,
        startedAt: startedAtIso,
        endedAt: s.endedAt ? s.endedAt.toISOString() : null,
        completedCount: s._count.songRequests,
        durationMinutes: s.endedAt
          ? Math.floor(
              (s.endedAt.getTime() - s.startedAt.getTime()) / 1000 / 60,
            )
          : null,
        albumArtPreviews: previewMap.get(s.id) ?? [],
        sessionKey,
      };
    });
  }

  /**
   * 통합 캘린더 검색용 — 곡 제목/아티스트로 공개 셋리스트(종료 세션) 검색.
   *
   * `getPublicSetlists` 와 동일한 공개 가시성 규칙(STANDARD + ENDED + PUBLIC +
   * sourcePerformanceId null + 재생 완료 곡 ≥ 1)을 따르되, COMPLETED 신청곡 중
   * 키워드(rawTitle / rawArtist / song.title)가 매칭되는 세션만 반환한다.
   *
   * 공개 목록의 90일 cap 과 달리, 범위는 호출자(통합 캘린더 = 13개월 cap)가 이미
   * 검증한 `[from, to)` 를 그대로 적용한다. 각 결과에 매칭된 대표 곡 제목
   * (`matchedSongTitle`) 을 함께 담아 검색 결과 카드에 "왜 매칭됐는지" 를 노출한다.
   */
  async searchPublicSetlists(
    identifier: string,
    keyword: string,
    range: { from: Date; to: Date },
    limit = 50,
  ): Promise<
    Array<{ summary: PublicSetlistSummaryDto; matchedSongTitle: string | null }>
  > {
    const term = keyword.trim();
    if (!term) return [];

    const channelId =
      await this.channelService.resolveChannelIdByIdentifier(identifier);
    if (!channelId) {
      throw new ResourceNotFoundException('채널을 찾을 수 없습니다.');
    }

    const songMatch = {
      status: SongRequestStatus.COMPLETED,
      OR: [
        { rawTitle: { contains: term } },
        { rawArtist: { contains: term } },
        { song: { is: { title: { contains: term } } } },
      ],
    };

    const where = {
      channelId,
      sessionType: LiveSessionType.STANDARD,
      status: LiveSessionStatus.ENDED,
      visibility: 'PUBLIC' as const,
      sourcePerformanceId: null,
      startedAt: { gte: range.from, lt: range.to },
      songRequests: { some: songMatch },
    } as const;

    const sessions = await this.prisma.liveSession.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        platform: true,
        platformChannelId: true,
        startedAt: true,
        endedAt: true,
        _count: {
          select: {
            songRequests: {
              where: { status: SongRequestStatus.COMPLETED },
            },
          },
        },
        // 매칭된 대표 곡 1개 — 검색 결과 카드 표시용.
        songRequests: {
          where: songMatch,
          orderBy: [{ playedAt: 'asc' }, { createdAt: 'asc' }],
          take: 1,
          select: { rawTitle: true, song: { select: { title: true } } },
        },
      },
    });

    const summaries = await this.buildSetlistSummaries(sessions);
    return summaries.map((summary, i) => {
      const matched = sessions[i].songRequests[0];
      const matchedSongTitle = matched
        ? (matched.song?.title ?? matched.rawTitle)
        : null;
      return { summary, matchedSongTitle };
    });
  }

  /**
   * 공개용 셋리스트 가용성 체크 — 채널 페이지 layout에서 탭 노출 결정용.
   * 가벼운 COUNT 쿼리만 수행.
   */
  async getPublicSetlistAvailability(identifier: string) {
    const channelId =
      await this.channelService.resolveChannelIdByIdentifier(identifier);
    if (!channelId) {
      return { available: false, count: 0 };
    }

    const count = await this.prisma.liveSession.count({
      where: {
        channelId,
        sessionType: LiveSessionType.STANDARD,
        status: LiveSessionStatus.ENDED,
        visibility: 'PUBLIC',
        sourcePerformanceId: null,
        songRequests: {
          some: { status: SongRequestStatus.COMPLETED },
        },
      },
    });

    return { available: count > 0, count };
  }

  /**
   * 채널 owner / canManageContent 매니저용 셋리스트 관리 목록.
   *
   * 공개 목록 (`getPublicSetlists`) 과 달리 visibility 필터를 적용하지 않으므로
   * PUBLIC + PRIVATE 셋리스트를 모두 반환한다. 응답에 visibility 필드를 포함시켜
   * 관리 페이지에서 비공개 토글 상태를 표시.
   *
   * 권한: 채널 소유자 또는 canManageContent=true 인 활성 매니저만 허용.
   */
  async getManageSetlists(
    userId: number,
    identifier: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const channelId =
      await this.channelService.resolveChannelIdByIdentifier(identifier);
    if (!channelId) {
      throw new ResourceNotFoundException('채널을 찾을 수 없습니다.');
    }

    await this.ensureChannelContentPermission(
      channelId,
      userId,
      '셋리스트를 관리할 권한이 없습니다.',
    );

    const where = {
      channelId,
      sessionType: LiveSessionType.STANDARD,
      status: LiveSessionStatus.ENDED,
      sourcePerformanceId: null,
      songRequests: {
        some: { status: SongRequestStatus.COMPLETED },
      },
    } as const;

    const skip = (page - 1) * limit;

    const [sessions, total] = await Promise.all([
      this.prisma.liveSession.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          platform: true,
          platformChannelId: true,
          startedAt: true,
          endedAt: true,
          visibility: true,
          _count: {
            select: {
              songRequests: {
                where: { status: SongRequestStatus.COMPLETED },
              },
            },
          },
        },
      }),
      this.prisma.liveSession.count({ where }),
    ]);

    // 카드 미리보기용 앨범아트 — 공개 목록과 동일 로직 (세션당 distinct 최대 6장).
    const previewMap = new Map<number, string[]>();
    await Promise.all(
      sessions.map(async (s) => {
        const rows = await this.prisma.songRequest.findMany({
          where: {
            liveSessionId: s.id,
            status: SongRequestStatus.COMPLETED,
          },
          orderBy: [{ playedAt: 'asc' }, { createdAt: 'asc' }],
          take: 16,
          select: {
            song: { select: { albumArt: true, coverUrl: true } },
          },
        });
        const arts: string[] = [];
        for (const row of rows) {
          const art = row.song?.albumArt ?? row.song?.coverUrl ?? null;
          if (!art) continue;
          if (!arts.includes(art)) {
            arts.push(art);
            if (arts.length >= 6) break;
          }
        }
        previewMap.set(s.id, arts);
      }),
    );

    const setlists = sessions.map((s) => ({
      sessionId: s.id,
      platform: s.platform,
      platformChannelId: s.platformChannelId,
      startedAt: s.startedAt.toISOString(),
      endedAt: s.endedAt ? s.endedAt.toISOString() : null,
      completedCount: s._count.songRequests,
      durationMinutes: s.endedAt
        ? Math.floor(
            (s.endedAt.getTime() - s.startedAt.getTime()) / 1000 / 60,
          )
        : null,
      albumArtPreviews: previewMap.get(s.id) ?? [],
      visibility: s.visibility,
    }));

    return {
      setlists,
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  /**
   * 셋리스트 (LiveSession) 가시성 토글.
   *
   * 권한: 채널 소유자 또는 canManageContent 매니저만. 다른 채널 세션 ID 접근 차단을 위해
   * 채널 소유 검증 후 sessionId 가 해당 채널 소속인지 확인.
   *
   * 결과는 변경된 세션의 새 visibility 만 반환 (반영 확인용).
   */
  async updateSetlistVisibility(
    userId: number,
    identifier: string,
    sessionId: number,
    visibility: ScheduleVisibility,
  ): Promise<{ sessionId: number; visibility: ScheduleVisibility }> {
    const channelId =
      await this.channelService.resolveChannelIdByIdentifier(identifier);
    if (!channelId) {
      throw new ResourceNotFoundException('채널을 찾을 수 없습니다.');
    }

    await this.ensureChannelContentPermission(
      channelId,
      userId,
      '셋리스트를 관리할 권한이 없습니다.',
    );

    const session = await this.prisma.liveSession.findFirst({
      where: { id: sessionId, channelId },
      select: { id: true },
    });
    if (!session) {
      throw new ResourceNotFoundException('세션을 찾을 수 없습니다.');
    }

    const updated = await this.prisma.liveSession.update({
      where: { id: sessionId },
      data: { visibility },
      select: { id: true, visibility: true },
    });

    return { sessionId: updated.id, visibility: updated.visibility };
  }

  /**
   * 공개용 셋리스트 상세 — 특정 종료 세션의 재생 완료된 곡 리스트 (시간순).
   * 채널 검증으로 다른 채널 세션 ID 접근 차단.
   */
  async getPublicSetlistDetail(identifier: string, sessionId: number) {
    const channelId =
      await this.channelService.resolveChannelIdByIdentifier(identifier);
    if (!channelId) {
      throw new ResourceNotFoundException('채널을 찾을 수 없습니다.');
    }

    const session = await this.prisma.liveSession.findFirst({
      where: {
        id: sessionId,
        channelId,
        status: LiveSessionStatus.ENDED,
        visibility: 'PUBLIC',
        sourcePerformanceId: null,
      },
      select: {
        id: true,
        platform: true,
        platformChannelId: true,
        startedAt: true,
        endedAt: true,
        settings: { select: { showRequesterName: true } },
        songRequests: {
          where: {
            status: SongRequestStatus.COMPLETED,
            source: { not: SongRequestSource.COMPETITOR },
          },
          orderBy: [{ playedAt: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            songId: true,
            rawArtist: true,
            rawTitle: true,
            requesterNickname: true,
            isAnonymous: true,
            playedAt: true,
            completedAt: true,
            clipRejectedAt: true,
            song: {
              select: {
                id: true,
                title: true,
                albumArt: true,
                coverUrl: true,
                artist: { select: { name: true } },
              },
            },
            clip: {
              select: {
                id: true,
                status: true,
                deletedAt: true,
                thumbnailUrl: true,
                duration: true,
                autoGenerated: true,
              },
            },
          },
        },
      },
    });

    if (!session) {
      throw new ResourceNotFoundException('세션을 찾을 수 없습니다.');
    }

    // 채널이 신청자 닉네임 노출을 끈 세션이면 모두 익명 처리.
    // settings 자체가 없으면 안전한 default true.
    const showRequesterName = session.settings?.showRequesterName ?? true;

    const previewArts: string[] = [];
    for (const sr of session.songRequests) {
      const art = sr.song?.albumArt ?? sr.song?.coverUrl ?? null;
      if (!art) continue;
      if (!previewArts.includes(art)) {
        previewArts.push(art);
        if (previewArts.length >= 4) break;
      }
    }

    const startedAtIso = session.startedAt.toISOString();
    const summary = {
      sessionId: session.id,
      platform: session.platform,
      platformChannelId: session.platformChannelId,
      startedAt: startedAtIso,
      endedAt: session.endedAt ? session.endedAt.toISOString() : null,
      completedCount: session.songRequests.length,
      albumArtPreviews: previewArts,
      durationMinutes: session.endedAt
        ? Math.floor(
            (session.endedAt.getTime() - session.startedAt.getTime()) /
              1000 /
              60,
          )
        : null,
      sessionKey:
        session.platform && session.platformChannelId
          ? `${session.platform}:${session.platformChannelId}:${startedAtIso}`
          : null,
    };

    const songs = session.songRequests.map((sr) => {
      const visibleClip =
        sr.clip &&
        sr.clipRejectedAt === null &&
        sr.clip.status === PostStatus.VISIBLE &&
        sr.clip.deletedAt === null
          ? {
              id: sr.clip.id,
              thumbnailUrl: sr.clip.thumbnailUrl,
              duration: sr.clip.duration,
              autoGenerated: sr.clip.autoGenerated,
            }
          : null;

      return {
        id: sr.id,
        songId: sr.songId,
        title: sr.song?.title ?? sr.rawTitle,
        artist: sr.song?.artist?.name ?? sr.rawArtist,
        albumArt: sr.song?.albumArt ?? sr.song?.coverUrl ?? null,
        requesterNickname: showRequesterName ? sr.requesterNickname : '',
        isAnonymous: showRequesterName ? sr.isAnonymous : true,
        playedAt: sr.playedAt ? sr.playedAt.toISOString() : null,
        completedAt: sr.completedAt ? sr.completedAt.toISOString() : null,
        clip: visibleClip,
      };
    });

    return { summary, songs };
  }

  /**
   * 세션 설정 업데이트.
   *
   * 2026-05-14 P0 재설계 후 채널/세션 scope 분리:
   *  - paused / requestEnabled (라이브 한정 일시 상태) -> LiveSessionSettings 에 update
   *  - 그 외 18 필드 (채널 영구 설정) -> ChannelSongRequestSettings 에 upsert (lazy create 포함)
   *
   * 옛 클라이언트가 채널-scope 필드를 같이 PATCH 해도 backward-compat 으로 channel 에 forward.
   * 응답 + 이벤트 payload 는 EffectiveSongRequestSettings.
   */
  async updateSettings(
    sessionId: number,
    userId: number,
    dto: UpdateSettingsDto,
  ): Promise<EffectiveSongRequestSettings> {
    const session = await this.prisma.liveSession.findFirst({
      where: { id: sessionId },
      include: { settings: true },
    });

    if (!session) {
      throw new ResourceNotFoundException('세션을 찾을 수 없습니다.');
    }

    await this.ensureChannelSettingsPermission(
      session.channelId,
      userId,
      '세션을 수정할 권한이 없습니다.',
    );

    if (!session.settings) {
      throw new ResourceNotFoundException('세션 설정을 찾을 수 없습니다.');
    }

    const normalizedDto: UpdateSettingsDto = { ...dto };
    if (normalizedDto.requestEnabled === false) {
      normalizedDto.paused = false;
    }

    // 라이브 한정 일시 상태
    const liveScope: {
      requestEnabled?: boolean;
      paused?: boolean;
    } = {};
    if (normalizedDto.requestEnabled !== undefined) {
      liveScope.requestEnabled = normalizedDto.requestEnabled;
    }
    if (normalizedDto.paused !== undefined) {
      liveScope.paused = normalizedDto.paused;
    }
    const { liveSettings, channelSettings } = await this.prisma.$transaction(
      async (tx) => {
        const updatedLiveSettings =
          Object.keys(liveScope).length > 0
            ? await tx.liveSessionSettings.update({
                where: { id: session.settings!.id },
                data: liveScope,
              })
            : session.settings!;

        // 채널 영구 설정 (paused/requestEnabled 외 18 필드만 forward)
        const updatedChannelSettings =
          await this.channelSongRequestSettingsService.update(
            session.channelId,
            {
              requestCommand: normalizedDto.requestCommand,
              maxQueueSize: normalizedDto.maxQueueSize,
              donationPriorityEnabled: normalizedDto.donationPriorityEnabled,
              enforceDonationMinimumPrice:
                normalizedDto.enforceDonationMinimumPrice,
              karaokePlaybackMode: normalizedDto.karaokePlaybackMode,
              karaokeVideoType: normalizedDto.karaokeVideoType,
              donationOnlyEnabled: normalizedDto.donationOnlyEnabled,
              requestMode: normalizedDto.requestMode,
              chatRequestEnabled: normalizedDto.chatRequestEnabled,
              donationRequestEnabled: normalizedDto.donationRequestEnabled,
              allowAnonymous: normalizedDto.allowAnonymous,
              requireSongMatch: normalizedDto.requireSongMatch,
              randomRequestEnabled: normalizedDto.randomRequestEnabled,
              preventDuplicateSongs: normalizedDto.preventDuplicateSongs,
              blockedCategoryIds: normalizedDto.blockedCategoryIds,
              maxRequestsPerUser: normalizedDto.maxRequestsPerUser,
              maxTotalRequests: normalizedDto.maxTotalRequests,
              showRequesterName: normalizedDto.showRequesterName,
            },
            tx,
          );

        await enqueuePlaybackRevision(tx, session.id, {
          commandType: 'live_session.settings_changed',
        });
        return {
          liveSettings: updatedLiveSettings,
          channelSettings: updatedChannelSettings,
        };
      },
    );

    const effective = mergeEffectiveSongRequestSettings(
      liveSettings,
      channelSettings,
    );

    // 채널 settings 변경 → dispatcher cache invalidate + overlay socket broadcast
    // (라이브 한정 paused/requestEnabled 만 변경된 케이스도 active 면 overlay 알림).
    await this.channelSongRequestSettingsNotifier.notify(session.channelId);

    return effective;
  }

  /**
   * 스트리머/매니저가 수동으로 신청곡을 추가합니다.
   * reviveFromRequestId가 있으면 같은 세션의 기존 row(주로 COMPLETED/REJECTED)를
   * 조회해 곡 정보(songId/rawArtist/rawTitle/rawMessage)를 복사한 새 row를 생성한다.
   * 부활 시 기본 삽입 위치는 클라이언트가 명시적으로 지정 (FRONT 권장).
   */
  async createManualRequest(
    sessionId: number,
    userId: number,
    dto: CreateManualRequestDto,
  ) {
    const session = await this.prisma.liveSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        channelId: true,
      },
    });

    if (!session) {
      throw new ResourceNotFoundException('세션을 찾을 수 없습니다.');
    }

    await this.ensureChannelSettingsPermission(
      session.channelId,
      userId,
      '세션을 수정할 권한이 없습니다.',
    );

    const requester = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { nickname: true },
    });
    const requesterNickname = requester?.nickname?.trim() || `user-${userId}`;

    // 부활(revive) 모드: 같은 세션의 기존 row에서 곡 정보를 복사한다.
    // DTO의 rawArtist/rawTitle은 무시 (DTO ValidateIf로 빈 값 통과 허용).
    let songId = dto.songId;
    let rawArtist = dto.rawArtist;
    let rawTitle = dto.rawTitle;
    let rawMessage = dto.rawMessage;
    if (dto.reviveFromRequestId != null) {
      const original = await this.prisma.songRequest.findUnique({
        where: { id: dto.reviveFromRequestId },
        select: {
          songId: true,
          rawArtist: true,
          rawTitle: true,
          rawMessage: true,
          liveSessionId: true,
        },
      });
      if (!original) {
        throw new ResourceNotFoundException(
          '부활시킬 신청곡을 찾을 수 없습니다.',
        );
      }
      if (original.liveSessionId !== sessionId) {
        throw new BadRequestException(
          '같은 세션의 신청곡만 부활시킬 수 있습니다.',
        );
      }
      songId = original.songId ?? undefined;
      rawArtist = original.rawArtist;
      rawTitle = original.rawTitle;
      rawMessage = original.rawMessage ?? undefined;
    }

    return this.songRequestQueueService.addToQueue(sessionId, {
      songId,
      rawArtist,
      rawTitle,
      rawMessage,
      requesterPlatformId: `manual-${userId}`,
      requesterNickname,
      source: SongRequestSource.MANUAL,
      allowManualBypass: true,
      // songId 없이 수동 입력한 경우에는 노래책 자동 매칭을 건너뛰고 입력값을 그대로 사용
      skipSongMatch: songId == null,
      requestUserId: userId,
      insertPosition: dto.position,
      insertAfterRequestId: dto.afterRequestId,
    });
  }

  /**
   * 세션 종료
   */
  async endSession(sessionId: number, userId: number) {
    const session = await this.prisma.liveSession.findFirst({
      where: { id: sessionId },
    });

    if (!session) {
      throw new ResourceNotFoundException('세션을 찾을 수 없습니다.');
    }

    await this.ensureChannelSettingsPermission(
      session.channelId,
      userId,
      '세션을 종료할 권한이 없습니다.',
    );

    // 채널의 overlayToken 조회
    const channel = await this.prisma.channel.findUnique({
      where: { id: session.channelId },
      select: { overlayToken: true },
    });

    const endedSession = await this.prisma.$transaction(async (tx) => {
      const ended = await tx.liveSession.update({
        where: { id: sessionId },
        data: {
          status: LiveSessionStatus.ENDED,
          endedAt: new Date(),
          ...(session.visibility === ScheduleVisibility.PRIVATE
            ? {
                extractScheduledAt: null,
                extractStatus: LiveSessionExtractStatus.completed,
              }
            : {}),
        },
        select: liveSessionWithSettingsSelect,
      });

      if (session.visibility === ScheduleVisibility.PRIVATE) {
        await tx.songRequest.deleteMany({ where: { liveSessionId: sessionId } });
      }

      await enqueuePlaybackRevision(tx, sessionId, {
        commandType: 'live_session.ended',
      });
      return ended;
    });

    this.metricsService.liveSessionsEndedTotal.inc({
      platform: endedSession.platform,
      end_type: 'manual',
    });

    if (session.createdAt) {
      const durationSeconds =
        (Date.now() - new Date(session.createdAt).getTime()) / 1000;
      this.metricsService.liveSessionDurationSeconds.observe(
        { platform: endedSession.platform },
        durationSeconds,
      );
    }

    // 세션 종료 이벤트 발행 (오버레이에 알림)
    if (channel?.overlayToken) {
      this.eventEmitter.emit('live-session.ended', {
        overlayToken: channel.overlayToken,
        sessionId,
      });
    }

    this.notifyDispatcher({
      event: 'session.ended',
      sessionId,
    }).catch((err) =>
      this.logger.warn(`Dispatcher webhook failed: ${err?.message}`),
    );

    return endedSession;
  }

  /**
   * meloming-native 라이브 시작 — meloming-live-service 의 IVS Stream Start 이벤트
   * (LL_HLS) 또는 WebRTC audio session 시작 hook 에서 internal API 로 호출.
   *
   * 외부 플랫폼 startSession 과 달리 verification 검사 없음 (meloming 자체 채널).
   * platform=MELOMING, platformChannelId=channelId.toString() 으로 row INSERT.
   * 이미 활성 meloming session 이 있으면 idempotent return.
   */
  async startMelomingLiveSession(
    channelId: number,
    userId: number,
  ): Promise<LiveSessionWithSettings> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, name: true, userId: true, overlayToken: true },
    });
    if (!channel) {
      throw new ResourceNotFoundException('채널을 찾을 수 없습니다.');
    }

    // idempotent — 이미 활성 meloming session 이 있으면 그것 반환.
    const existing = await this.prisma.liveSession.findFirst({
      where: {
        channelId,
        platform: StreamPlatform.MELOMING,
        status: LiveSessionStatus.ACTIVE,
        sessionType: LiveSessionType.STANDARD,
      },
      select: liveSessionWithSettingsSelect,
    });
    if (existing) {
      this.logger.log(
        `meloming session already active for channel ${channelId}: ${existing.id}`,
      );
      return await this.withEffectiveSettings(existing);
    }

    // overlayToken 보장.
    let overlayToken = channel.overlayToken;
    if (!overlayToken) {
      overlayToken = randomBytes(32).toString('hex');
      await this.prisma.channel.update({
        where: { id: channelId },
        data: { overlayToken },
      });
    }

    // 채널 단위 settings 가 source of truth (2026-05-14 P0 재설계).
    // 신규 채널 첫 라이브 lazy create 보장.
    await this.channelSongRequestSettingsService.getByChannelId(channelId);

    const session = await this.prisma.$transaction(async (tx) => {
      const newSession = await tx.liveSession.create({
        data: {
          channelId,
          userId,
          platform: StreamPlatform.MELOMING,
          platformChannelId: channelId.toString(),
          overlayToken,
          status: LiveSessionStatus.ACTIVE,
          sessionType: LiveSessionType.STANDARD,
        },
        select: liveSessionWithSettingsSelect,
      });

      await tx.liveSessionSettings.create({
        data: {
          liveSessionId: newSession.id,
          requestEnabled: true,
          paused: false,
        },
      });

      // 세션 시작도 snapshot-producing command (GATE 0).
      await enqueuePlaybackRevision(tx, newSession.id, {
        commandType: 'live_session.started',
      });

      return tx.liveSession.findUnique({
        where: { id: newSession.id },
        select: liveSessionWithSettingsSelect,
      });
    });

    if (!session) {
      throw new Error('meloming 세션 생성 후 조회 실패');
    }

    const effectiveSession = await this.withEffectiveSettings(session);

    this.eventEmitter.emit('live-session.started', {
      overlayToken,
      sessionId: effectiveSession.id,
      settings: effectiveSession.settings,
    });

    this.notifyDispatcher({
      event: 'session.started',
      sessionId: session.id,
      channelId,
      platform: session.platform,
      platformChannelId: session.platformChannelId,
      startedAt: session.startedAt.toISOString(),
    }).catch((err) =>
      this.logger.warn(
        `Dispatcher webhook failed (meloming start): ${err?.message}`,
      ),
    );

    this.metricsService.liveSessionsStartedTotal.inc({
      platform: 'MELOMING',
      result: 'success',
    });

    this.logger.log(
      `Meloming live session started: ${session.id} for channel ${channelId}`,
    );

    return effectiveSession;
  }

  /**
   * meloming-native 라이브 종료 — IVS Stream End 이벤트 또는 audio session 종료
   * hook 에서 internal API 로 호출. 활성 meloming session 만 ENDED 로 전이.
   * 활성 세션 없으면 idempotent noop.
   */
  async endMelomingLiveSession(channelId: number): Promise<void> {
    const active = await this.prisma.liveSession.findFirst({
      where: {
        channelId,
        platform: StreamPlatform.MELOMING,
        status: LiveSessionStatus.ACTIVE,
        sessionType: LiveSessionType.STANDARD,
      },
    });
    if (!active) {
      return; // idempotent
    }

    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { overlayToken: true },
    });

    const endedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.liveSession.update({
        where: { id: active.id },
        data: { status: LiveSessionStatus.ENDED, endedAt },
      });
      await enqueuePlaybackRevision(tx, active.id, {
        commandType: 'live_session.ended',
      });
    });

    if (active.createdAt) {
      const durationSeconds =
        (Date.now() - new Date(active.createdAt).getTime()) / 1000;
      this.metricsService.liveSessionDurationSeconds.observe(
        { platform: 'MELOMING' },
        durationSeconds,
      );
    }

    this.metricsService.liveSessionsEndedTotal.inc({
      platform: 'MELOMING',
      end_type: 'auto',
    });

    if (channel?.overlayToken) {
      this.eventEmitter.emit('live-session.ended', {
        overlayToken: channel.overlayToken,
        sessionId: active.id,
      });
    }

    this.notifyDispatcher({
      event: 'session.ended',
      sessionId: active.id,
    }).catch((err) =>
      this.logger.warn(
        `Dispatcher webhook failed (meloming end): ${err?.message}`,
      ),
    );

    this.logger.log(
      `Meloming live session ended: ${active.id} for channel ${channelId}`,
    );
  }

  /**
   * 플랫폼 채널 기준 활성 세션 시작 (내부/폴러 전용).
   * competitor 폴러가 외부 공연 시작을 감지했을 때 호출. 권한 체크 없음(시스템 트리거).
   * startSession 과 달리 channelId 가 아닌 (platform, platformChannelId) 로 진입하며
   * ChannelVerification(APPROVED) 로 멜로밍 채널을 해석. 이미 ACTIVE 세션이 있으면 noop.
   * forceEndByPlatforms 의 대칭 메서드.
   */
  async startByPlatforms(
    channels: {
      platform: StreamPlatform;
      platformChannelId: string;
      sourcePerformanceId: number;
    }[],
  ): Promise<Array<{ sessionId: number; channelId: number }>> {
    const started: Array<{ sessionId: number; channelId: number }> = [];
    for (const { platform, platformChannelId, sourcePerformanceId } of channels) {
      try {
        const verification = await this.prisma.channelVerification.findFirst({
          where: {
            platform,
            platformChannelId,
            status: ChannelVerificationStatus.APPROVED,
          },
          select: { channelId: true, userId: true },
        });
        if (!verification) {
          this.logger.debug(
            `[start-by-platform] no APPROVED verification: ${platform}/${platformChannelId}`,
          );
          continue;
        }

        const active = await this.prisma.liveSession.findFirst({
          where: {
            channelId: verification.channelId,
            status: LiveSessionStatus.ACTIVE,
            sessionType: LiveSessionType.STANDARD,
          },
          select: { id: true },
        });
        if (active) continue; // 이미 진행 중 (멜로밍 오버레이 or 이전 폴 사이클)

        const channel = await this.prisma.channel.findUnique({
          where: { id: verification.channelId },
          select: { overlayToken: true, name: true },
        });
        let overlayToken = channel?.overlayToken;
        if (!overlayToken) {
          overlayToken = randomBytes(32).toString('hex');
          await this.prisma.channel.update({
            where: { id: verification.channelId },
            data: { overlayToken },
          });
        }
        await this.channelSongRequestSettingsService.getByChannelId(
          verification.channelId,
        );

        const session = await this.prisma.$transaction(async (tx) => {
          const s = await tx.liveSession.create({
            data: {
              channelId: verification.channelId,
              userId: verification.userId,
              platform,
              platformChannelId,
              sourcePerformanceId,
              overlayToken,
              status: LiveSessionStatus.ACTIVE,
              sessionType: LiveSessionType.STANDARD,
            },
            select: liveSessionWithSettingsSelect,
          });
          await tx.liveSessionSettings.create({
            data: { liveSessionId: s.id, requestEnabled: true, paused: false },
          });
          // 세션 시작도 snapshot-producing command (GATE 0).
          await enqueuePlaybackRevision(tx, s.id, {
            commandType: 'live_session.started',
          });
          return tx.liveSession.findUnique({
            where: { id: s.id },
            select: liveSessionWithSettingsSelect,
          });
        });
        if (!session) continue;

        const effective = await this.withEffectiveSettings(session);
        this.eventEmitter.emit('live-session.started', {
          overlayToken,
          sessionId: effective.id,
          settings: effective.settings,
        });
        this.notifyDispatcher({
          event: 'session.started',
          sessionId: session.id,
          channelId: verification.channelId,
          platform: session.platform,
          platformChannelId: session.platformChannelId,
          startedAt: session.startedAt.toISOString(),
        }).catch((err) =>
          this.logger.warn(
            `Dispatcher webhook failed (start-by-platform): ${err?.message}`,
          ),
        );
        this.metricsService.liveSessionsStartedTotal.inc({
          platform,
          result: 'success',
        });
        this.logger.log(
          `[start-by-platform] started session=${session.id} channel=${verification.channelId} perf=${sourcePerformanceId ?? 'n/a'}`,
        );
        started.push({
          sessionId: session.id,
          channelId: verification.channelId,
        });
      } catch (error) {
        this.logger.error(
          `[start-by-platform] failed: ${platform}/${platformChannelId} error=${error}`,
        );
      }
    }
    return started;
  }

  /**
   * 플랫폼 채널 기준 자동 생성 세션 강제종료 (내부 API 전용)
   * discover가 방송 종료를 감지했을 때 호출한다.
   *
   * 사용자가 콘솔에서 직접 시작한 세션(sourcePerformanceId=null)은 방송 상태와
   * 독립적으로 유지해야 하므로 종료 대상에서 제외한다. sourcePerformanceId가 있는
   * 세션만 startByPlatforms가 만든 자동 라이프사이클 세션이다.
   */
  async forceEndByPlatforms(
    channels: { platform: StreamPlatform; platformChannelId: string }[],
  ): Promise<void> {
    for (const { platform, platformChannelId } of channels) {
      try {
        // 1차: ChannelVerification → channelId → ACTIVE 세션 (platform 컬럼 불일치 대응)
        // 2차: 직접 매칭 fallback (인증 레코드 없는 구형 세션 대응)
        const verification = await this.prisma.channelVerification.findFirst({
          where: {
            platform,
            platformChannelId,
            status: ChannelVerificationStatus.APPROVED,
          },
          select: { channelId: true },
        });

        const session = verification
          ? await this.prisma.liveSession.findFirst({
              where: {
                channelId: verification.channelId,
                status: LiveSessionStatus.ACTIVE,
                sessionType: LiveSessionType.STANDARD,
                sourcePerformanceId: { not: null },
              },
              select: { id: true, channelId: true },
            })
          : await this.prisma.liveSession.findFirst({
              where: {
                platform,
                platformChannelId,
                status: LiveSessionStatus.ACTIVE,
                sessionType: LiveSessionType.STANDARD,
                sourcePerformanceId: { not: null },
              },
              select: { id: true, channelId: true },
            });

        if (!session) {
          this.logger.debug(
            `[force-end] no active session: platform=${platform} channelId=${platformChannelId}`,
          );
          continue;
        }

        const channel = await this.prisma.channel.findUnique({
          where: { id: session.channelId },
          select: { overlayToken: true },
        });

        await this.prisma.$transaction(async (tx) => {
          await tx.liveSession.update({
            where: { id: session.id },
            data: {
              status: LiveSessionStatus.ENDED,
              endedAt: new Date(),
            },
          });
          await enqueuePlaybackRevision(tx, session.id, {
            commandType: 'live_session.force_ended',
          });
        });

        this.metricsService.liveSessionsEndedTotal.inc({
          platform,
          end_type: 'force_end',
        });

        if (channel?.overlayToken) {
          this.eventEmitter.emit('live-session.ended', {
            overlayToken: channel.overlayToken,
            sessionId: session.id,
          });
        }

        this.notifyDispatcher({
          event: 'session.ended',
          sessionId: session.id,
        }).catch(() => undefined);

        this.logger.log(
          `[force-end] ended: platform=${platform} channelId=${platformChannelId} sessionId=${session.id}`,
        );
      } catch (error) {
        this.logger.error(
          `[force-end] failed: platform=${platform} channelId=${platformChannelId} error=${error}`,
        );
      }
    }
  }


  /**
   * 가사 재생 상태 sync (콘솔 ↔ 콘솔 ↔ 오버레이)
   * Intent-Anchor 모델: state intent change 시에만 publish, manualMs 매 프레임 broadcast X
   */
  async publishLyricsPlaybackState(
    sessionId: number,
    userId: number,
    dto: LyricsPlaybackStateDto,
  ): Promise<void> {
    const session = await this.prisma.liveSession.findFirst({
      where: { id: sessionId },
      select: {
        id: true,
        channelId: true,
        status: true,
        overlayToken: true,
      },
    });

    if (!session) {
      throw new ResourceNotFoundException('세션을 찾을 수 없습니다.');
    }

    await this.ensureChannelSettingsPermission(
      session.channelId,
      userId,
      '세션을 수정할 권한이 없습니다.',
    );

    if (session.status !== LiveSessionStatus.ACTIVE) {
      return;
    }

    if (!session.overlayToken) {
      return;
    }

    this.eventEmitter.emit('overlay.lyrics.playback.state', {
      overlayToken: session.overlayToken,
      sessionId: session.id,
      state: {
        songRequestId: dto.songRequestId ?? null,
        playbackSource: dto.playbackSource,
        anchorMs: dto.anchorMs,
        anchorAt: dto.anchorAt ?? null,
        playbackRate: dto.playbackRate,
        durationMs: dto.durationMs,
        offsetMs: dto.offsetMs,
        clientInstanceId: dto.clientInstanceId,
        emittedAt: new Date().toISOString(),
      },
    });
  }

  /**
   * 세션 히스토리 목록 조회
   */
  async getSessionHistory(
    channelId: number,
    userId: number,
    page: number = 1,
    limit: number = 10,
  ) {
    await this.ensureChannelSettingsPermission(
      channelId,
      userId,
      '세션을 조회할 권한이 없습니다.',
    );

    const skip = (page - 1) * limit;

    const [sessions, total] = await Promise.all([
      this.prisma.liveSession.findMany({
        where: {
          channelId,
          sessionType: LiveSessionType.STANDARD,
          status: LiveSessionStatus.ENDED,
          sourcePerformanceId: null,
        },
        orderBy: { startedAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          platform: true,
          status: true,
          startedAt: true,
          endedAt: true,
          createdAt: true,
          _count: {
            select: {
              songRequests: true,
            },
          },
        },
      }),
      this.prisma.liveSession.count({
        where: {
          channelId,
          sessionType: LiveSessionType.STANDARD,
          status: LiveSessionStatus.ENDED,
          sourcePerformanceId: null,
        },
      }),
    ]);

    // 각 세션에 통계 추가
    const sessionsWithStats = await Promise.all(
      sessions.map(async (session) => {
        const stats = await this.prisma.songRequest.groupBy({
          by: ['status'],
          where: { liveSessionId: session.id },
          _count: true,
        });

        const totalDonation = await this.prisma.songRequest.aggregate({
          where: { liveSessionId: session.id },
          _sum: { donationAmount: true },
        });

        return {
          ...session,
          stats: {
            totalRequests: session._count.songRequests,
            completedCount:
              stats.find((s) => s.status === 'COMPLETED')?._count || 0,
            rejectedCount:
              stats.find((s) => s.status === 'REJECTED')?._count || 0,
            totalDonation: totalDonation._sum.donationAmount || 0,
          },
          duration: session.endedAt
            ? Math.floor(
                (new Date(session.endedAt).getTime() -
                  new Date(session.startedAt).getTime()) /
                  1000 /
                  60,
              )
            : null,
        };
      }),
    );

    return {
      sessions: sessionsWithStats,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * 이전 세션을 복제하여 새 세션 시작 (설정 + 신청곡 전체 복원)
   */
  async cloneSession(
    sourceSessionId: number,
    userId: number,
    identifier?: string,
  ): Promise<LiveSessionWithSettings> {
    // 원본 세션 + 설정 + 신청곡 조회
    const source = await this.prisma.liveSession.findUnique({
      where: { id: sourceSessionId, sourcePerformanceId: null },
      include: {
        settings: true,
        songRequests: {
          orderBy: [{ queueOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });

    if (!source) {
      throw new ResourceNotFoundException('원본 세션을 찾을 수 없습니다.');
    }

    // 원본 세션 채널 권한 확인
    await this.ensureChannelSettingsPermission(
      source.channelId,
      userId,
      '원본 세션에 대한 권한이 없습니다.',
    );

    // 대상 채널 결정 및 권한 확인
    const channelId = identifier
      ? await this.resolveAccessibleChannelId(
          userId,
          identifier,
          '세션을 시작할 권한이 없습니다.',
        )
      : source.channelId;

    if (!channelId) {
      throw new ResourceNotFoundException('채널을 찾을 수 없습니다.');
    }

    if (channelId !== source.channelId) {
      await this.ensureChannelSettingsPermission(
        channelId,
        userId,
        '세션을 시작할 권한이 없습니다.',
      );
    }

    // 활성 세션 확인
    const activeSession = await this.prisma.liveSession.findFirst({
      where: {
        channelId,
        status: LiveSessionStatus.ACTIVE,
        sessionType: LiveSessionType.STANDARD,
      },
    });

    if (activeSession) {
      throw new InvalidInputException('이미 활성화된 라이브 세션이 있습니다.');
    }

    // 채널 overlayToken 확인/생성
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { overlayToken: true },
    });

    if (!channel) {
      throw new ResourceNotFoundException('채널을 찾을 수 없습니다.');
    }

    let overlayToken = channel.overlayToken;
    if (!overlayToken) {
      overlayToken = randomBytes(32).toString('hex');
      await this.prisma.channel.update({
        where: { id: channelId },
        data: { overlayToken },
      });
    }

    // platform이 null이면 ChannelVerification에서 재결정
    let platform = source.platform;
    let platformChannelId = source.platformChannelId;
    if (!platform) {
      const approvedVerifications =
        await this.prisma.channelVerification.findMany({
          where: { channelId, status: ChannelVerificationStatus.APPROVED },
          select: { platform: true, platformChannelId: true },
          orderBy: { id: 'asc' },
        });
      const valid = approvedVerifications.filter((v) => v.platformChannelId);
      if (valid.length > 0) {
        platform = valid[0].platform;
        platformChannelId = valid[0].platformChannelId;
      }
    }

    // 채널 단위 settings lazy create (2026-05-14 P0 재설계).
    await this.channelSongRequestSettingsService.getByChannelId(channelId);

    // 트랜잭션: 세션 + 설정 + 신청곡 일괄 복제
    const session = await this.prisma.$transaction(async (tx) => {
      const newSession = await tx.liveSession.create({
        data: {
          channelId,
          userId,
          platform,
          platformChannelId,
          overlayToken,
          status: LiveSessionStatus.ACTIVE,
          sessionType: LiveSessionType.STANDARD,
        },
      });

      // 라이브 한정 상태만 source 에서 복제. 채널-scope 18 필드는
      // ChannelSongRequestSettings (channelId 1:1) 가 source of truth.
      await tx.liveSessionSettings.create({
        data: {
          liveSessionId: newSession.id,
          requestEnabled: source.settings?.requestEnabled ?? true,
          paused: false,
        },
      });

      // 신청곡 일괄 복제 (원본 상태 그대로 보존)
      // native 3필드(donationNativeAmount/donationCurrency/donationRateVersion)도 함께 복제해야
      // 클론 후에도 overlay/console에서 별풍선·치즈 네이티브 표시가 유지된다.
      // 원본이 pre-backfill legacy(donationAmount!=null, donationCurrency=null)면 이 시점에
      // KRW_LEGACY로 태깅하여 boot-time backfill에 의존하지 않는다.
      if (source.songRequests.length > 0) {
        await tx.songRequest.createMany({
          data: source.songRequests.map((req, idx) => ({
            liveSessionId: newSession.id,
            songId: req.songId,
            rawArtist: req.rawArtist,
            rawTitle: req.rawTitle,
            rawMessage: req.rawMessage,
            requesterPlatformId: req.requesterPlatformId,
            requesterNickname: req.requesterNickname,
            status: req.status,
            source: req.source,
            donationAmount: req.donationAmount,
            donationNativeAmount: req.donationNativeAmount,
            donationCurrency:
              req.donationCurrency ??
              (req.donationAmount != null ? 'KRW_LEGACY' : null),
            donationRateVersion: req.donationRateVersion,
            priority: req.priority,
            queueOrder: idx + 1,
            calculatedPrice: req.calculatedPrice,
            priceSource: req.priceSource,
            playedAt: req.playedAt,
            completedAt: req.completedAt,
            rejectionReason: req.rejectionReason,
            requestUserId: req.requestUserId,
          })),
        });
      }

      // 세션 복제(=새 세션 시작)도 snapshot-producing command (GATE 0).
      await enqueuePlaybackRevision(tx, newSession.id, {
        commandType: 'live_session.cloned',
      });

      return tx.liveSession.findUnique({
        where: { id: newSession.id },
        select: liveSessionWithSettingsSelect,
      });
    });

    if (!session) {
      throw new Error('세션 복제 후 조회 실패');
    }

    const effectiveSession = await this.withEffectiveSettings(session);

    // 채팅 수집 시작 (Redis Stream 소비)
    // 세션 시작 이벤트
    this.eventEmitter.emit('live-session.started', {
      overlayToken,
      sessionId: effectiveSession.id,
      settings: effectiveSession.settings,
    });

    this.notifyDispatcher({
      event: 'session.started',
      sessionId: session.id,
      channelId,
      platform: session.platform,
      platformChannelId: session.platformChannelId,
      startedAt: session.startedAt.toISOString(),
    }).catch((err) =>
      this.logger.warn(`Dispatcher webhook failed: ${err?.message}`),
    );

    this.logger.log(
      `Live session cloned: ${source.id} → ${session.id} for channel ${channelId} (${source.songRequests.length} requests)`,
    );

    return effectiveSession;
  }

  /**
   * 세션 상세 조회 (신청곡 포함)
   */
  async getSessionDetail(sessionId: number, userId: number) {
    const session = await this.prisma.liveSession.findUnique({
      where: { id: sessionId, sourcePerformanceId: null },
      include: {
        settings: true,
        channel: {
          select: {
            id: true,
            name: true,
            webPath: true,
            profileImageUrl: true,
          },
        },
        songRequests: {
          where: { source: { not: SongRequestSource.COMPETITOR } },
          orderBy: [{ playedAt: 'asc' }, { createdAt: 'asc' }],
          include: {
            song: {
              select: {
                id: true,
                title: true,
                artist: true,
                albumArt: true,
              },
            },
          },
        },
      },
    });

    if (!session) {
      throw new ResourceNotFoundException('세션을 찾을 수 없습니다.');
    }

    await this.ensureChannelSettingsPermission(
      session.channelId,
      userId,
      '세션을 조회할 권한이 없습니다.',
    );

    // 통계 계산
    const stats = {
      totalRequests: session.songRequests.length,
      completedCount: session.songRequests.filter(
        (r) => r.status === 'COMPLETED',
      ).length,
      rejectedCount: session.songRequests.filter((r) => r.status === 'REJECTED')
        .length,
      pendingCount: session.songRequests.filter((r) => r.status === 'PENDING')
        .length,
      totalDonation: session.songRequests.reduce(
        (sum, r) => sum + (r.donationAmount || 0),
        0,
      ),
      donationRequests: session.songRequests.filter(
        (r) => r.donationAmount && r.donationAmount > 0,
      ).length,
    };

    // 재생 시간 계산
    const duration = session.endedAt
      ? Math.floor(
          (new Date(session.endedAt).getTime() -
            new Date(session.startedAt).getTime()) /
            1000 /
            60,
        )
      : null;

    return {
      id: session.id,
      platform: session.platform,
      status: session.status,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      duration,
      channel: session.channel,
      settings: session.settings,
      stats,
      songRequests: session.songRequests.map((req, index) => ({
        id: req.id,
        order: index + 1,
        title: req.song?.title || req.rawTitle,
        artist: req.song?.artist?.name || req.rawArtist,
        requester: req.requesterNickname,
        status: req.status,
        source: req.source,
        donationAmount: req.donationAmount,
        playedAt: req.playedAt,
        completedAt: req.completedAt,
        rejectionReason: req.rejectionReason,
        createdAt: req.createdAt,
        albumArt: req.song?.albumArt,
      })),
    };
  }
}
