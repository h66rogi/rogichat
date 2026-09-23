import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  SongRequestSource,
  SongRequestStatus,
  SongRequestType,
  StreamPlatform,
  LiveSessionType,
} from '@prisma/client';
import {
  songRequestWithSongSelect,
  songRequestHistorySelect,
  SongRequestWithSong,
} from './prisma/song-request.selections';
import { CreateSongRequestDto } from './dto/request/create-request.dto';
import { UpdateSongRequestStatusDto } from './dto/request/update-status.dto';
import { SongRequestQueueService } from './song-request-queue.service';
import { SONG_REQUEST_EVENTS } from './events/song-request.events';
import { SongPricingService } from '../song-pricing/song-pricing.service';
import { CurrencyConfig } from '../song-pricing/types/pricing.types';
import { buildPaginationMeta } from '../search/dto/paginated-search-response.dto';
import { SongRequestHistoryResponseDto } from './dto/response/song-request-history.response.dto';
import { MetricsService } from '../metrics';
import { ChannelService } from '../channel/channel.service';
import { attachSyncRequestAvailableChannels } from './sync-request-available-channels';
import { REDIS_CLIENT, type AppRedisClient } from '../redis/redis.tokens';
import { enqueuePlaybackRevision } from '../overlay-playback/bump-playback-revision';

type SongRequestWithFormattedPrice = SongRequestWithSong & {
  formattedPrice?: string;
};

type StatusTransitionSource = {
  playedAt: Date | null;
};

const NEXT_PLAYABLE_STATUSES: SongRequestStatus[] = [
  SongRequestStatus.PENDING,
  SongRequestStatus.ACCEPTED,
];
const SONG_ADVANCE_COOLDOWN_MS = 3000;
const IGNORED_ADVANCE_RESPONSE_DELAY_MS = 300;

@Injectable()
export class SongRequestService {
  private readonly logger = new Logger(SongRequestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: SongRequestQueueService,
    private readonly eventEmitter: EventEmitter2,
    private readonly songPricingService: SongPricingService,
    private readonly metricsService: MetricsService,
    private readonly channelService: ChannelService,
    @Inject(REDIS_CLIENT) private readonly redis: AppRedisClient,
  ) {}

  private async acquireAdvanceCooldown(
    liveSessionId: number,
    action: 'play-next' | 'skip-current',
  ): Promise<boolean> {
    const key = `song-request:advance-cooldown:${liveSessionId}`;

    try {
      const acquired = await this.redis.set(key, action, {
        NX: true,
        PX: SONG_ADVANCE_COOLDOWN_MS,
      });

      if (acquired === 'OK') {
        return true;
      }

      this.logger.warn(
        `Ignored duplicate song advance action=${action} liveSessionId=${liveSessionId} cooldownMs=${SONG_ADVANCE_COOLDOWN_MS}`,
      );
      return false;
    } catch (error) {
      this.logger.error(
        `Blocked song advance because Redis cooldown failed action=${action} liveSessionId=${liveSessionId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }

  private async getNowPlayingAfterIgnoredAdvance(
    liveSessionId: number,
  ): Promise<SongRequestWithFormattedPrice | null> {
    await new Promise((resolve) =>
      setTimeout(resolve, IGNORED_ADVANCE_RESPONSE_DELAY_MS),
    );

    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      const current = await this.getNowPlaying(liveSessionId);
      if (current) {
        return current;
      }
    }

    return null;
  }

  /**
   * 채널 운영자(스트리머/활성 매니저/사이트 관리자) 여부 판별.
   * 신청곡 제한(requestMode/donationOnly/maxPerUser/중복 등)을 우회할 수 있는 권한 기준.
   *
   * 매니저는 isActive만 확인하고 canManage* 세부 권한은 요구하지 않는다.
   * ChannelPermissionGuard(scope별 specific 권한 요구)와는 의도적으로 다른 정책 — "신청곡 추가"는
   * 채널 운영을 돕는 사람이면 누구나 자유롭게 할 수 있어야 한다는 요구사항(스트리머 본인뿐 아니라
   * 매니저도 콘솔 외 일반 신청 화면에서 무적). 더 엄격하게 가져가야 할 신규 케이스가 생기면
   * canManageSongRequests 같은 별도 플래그를 도입할 것.
   */
  async isChannelOperator(
    channelId: number,
    userId: number,
    isAdmin: boolean,
  ): Promise<boolean> {
    if (isAdmin) return true;
    const isOwner = await this.channelService.validateChannelOwnership(
      channelId,
      userId,
    );
    if (isOwner) return true;
    const manager = await this.channelService.getManagerPermissions(
      channelId,
      userId,
    );
    return manager?.isActive === true;
  }

  /**
   * liveSessionId로부터 channelId를 조회한다.
   * 세션이 없으면 null.
   */
  async getChannelIdByLiveSessionId(
    liveSessionId: number,
  ): Promise<number | null> {
    const session = await this.prisma.liveSession.findUnique({
      where: { id: liveSessionId },
      select: { channelId: true },
    });
    return session?.channelId ?? null;
  }

  async canBypassSongRequestLimits(
    liveSessionId: number,
    userId: number,
    isAdmin: boolean,
  ): Promise<boolean> {
    if (isAdmin) return true;

    const session = await this.prisma.liveSession.findUnique({
      where: { id: liveSessionId },
      select: {
        channelId: true,
        sessionType: true,
        syncRoom: {
          select: {
            ownerId: true,
            channels: {
              select: {
                channel: {
                  select: { userId: true },
                },
              },
            },
          },
        },
      },
    });

    if (!session) return false;

    if (session.sessionType === LiveSessionType.SYNC && session.syncRoom) {
      return (
        session.syncRoom.ownerId === userId ||
        session.syncRoom.channels.some(
          (member) => member.channel.userId === userId,
        )
      );
    }

    return this.isChannelOperator(session.channelId, userId, isAdmin);
  }

  async assertCanOperateSession(
    liveSessionId: number,
    userId: number,
    isAdmin: boolean,
  ): Promise<void> {
    const session = await this.prisma.liveSession.findUnique({
      where: { id: liveSessionId },
      select: {
        channelId: true,
        sessionType: true,
        syncRoom: {
          select: {
            ownerId: true,
            channels: {
              select: {
                channel: {
                  select: { userId: true },
                },
              },
            },
          },
        },
      },
    });
    if (!session) {
      throw new NotFoundException('세션을 찾을 수 없습니다.');
    }
    if (
      await this.canOperateLiveSession(
        session,
        userId,
        isAdmin,
      )
    ) {
      return;
    }
    throw new ForbiddenException('신청곡 콘솔을 조작할 권한이 없습니다.');
  }

  private async canOperateLiveSession(
    session: {
      channelId: number;
      sessionType: LiveSessionType;
      syncRoom?: {
        ownerId: number;
        channels: Array<{ channel: { userId: number } }>;
      } | null;
    },
    userId: number,
    isAdmin: boolean,
  ): Promise<boolean> {
    if (isAdmin) return true;

    if (session.sessionType === LiveSessionType.SYNC && session.syncRoom) {
      return (
        session.syncRoom.ownerId === userId ||
        session.syncRoom.channels.some(
          (member) => member.channel.userId === userId,
        )
      );
    }

    try {
      await this.assertCanOperateChannel(session.channelId, userId, isAdmin);
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        return false;
      }
      throw error;
    }
  }

  async assertCanOperateRequest(
    requestId: number,
    userId: number,
    isAdmin: boolean,
  ): Promise<void> {
    const request = await this.prisma.songRequest.findUnique({
      where: { id: requestId },
      select: {
        liveSession: {
          select: {
            channelId: true,
            sessionType: true,
            syncRoom: {
              select: {
                ownerId: true,
                channels: {
                  select: {
                    channel: {
                      select: { userId: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!request) {
      throw new NotFoundException('신청곡을 찾을 수 없습니다.');
    }
    if (
      await this.canOperateLiveSession(
        request.liveSession,
        userId,
        isAdmin,
      )
    ) {
      return;
    }
    throw new ForbiddenException('신청곡 콘솔을 조작할 권한이 없습니다.');
  }

  async assertCanOperateChannel(
    channelId: number,
    userId: number,
    isAdmin: boolean,
  ): Promise<void> {
    if (isAdmin) return;

    const isOwner = await this.channelService.validateChannelOwnership(
      channelId,
      userId,
    );
    if (isOwner) return;

    const manager = await this.channelService.getManagerPermissions(
      channelId,
      userId,
    );
    if (manager?.isActive === true && manager.canManageSettings === true) {
      return;
    }

    throw new ForbiddenException('신청곡 콘솔을 조작할 권한이 없습니다.');
  }

  /**
   * 세션의 신청곡 대기열을 조회합니다.
   */
  async getQueueBySessionId(
    liveSessionId: number,
    includeCompleted = false,
  ): Promise<{ requests: SongRequestWithFormattedPrice[]; total: number }> {
    const requests = await this.queueService.getQueue(
      liveSessionId,
      includeCompleted,
    );
    const pricingContext = await this.buildPricingContext(liveSessionId);
    const requestsWithFormattedPrice = requests.map((request) =>
      this.withFormattedPrice(request, pricingContext),
    );

    return {
      requests: requestsWithFormattedPrice,
      total: requestsWithFormattedPrice.length,
    };
  }

  /**
   * 신청곡을 수동으로 추가합니다.
   *
   * @param allowManualBypass true이고 source가 MANUAL이면 모든 신청곡 제한
   *   (requestMode, donationOnly, chat/donationOnly toggle, max per user, 중복방지,
   *   blocked category, 최소 후원금액, 최대 누적 등)을 우회. 채널 운영자(owner/매니저/admin)
   *   또는 콘솔 토큰 인증된 호출자에게만 허용.
   * @param clientIp 공개 경로에서 비로그인 유저의 IP (익명 신청 platformId 해시,
   *   maxRequestsPerUser/preventDuplicate 스코프에 사용). internal 경로는 불필요.
   * @param isConsoleRequest true일 때만 콘솔 경로로 인정하여 DTO의 requesterPlatformId/
   *   requesterNickname을 신뢰. 공개 웹 경로(운영자 로그인 포함)는 false — 운영자가
   *   공개 엔드포인트에서 DTO identity를 쏴도 서버가 userId 기반으로 재구성 (사칭 방어).
   */
  async createRequest(
    dto: CreateSongRequestDto,
    requestUserId?: number,
    isInternalRequest?: boolean,
    allowManualBypass?: boolean,
    clientIp?: string,
    isConsoleRequest?: boolean,
  ): Promise<SongRequestWithFormattedPrice> {
    const requestType = dto.requestType ?? SongRequestType.NORMAL;
    const isRandomRequest = requestType === SongRequestType.RANDOM;

    // 랜덤 신청은 백엔드가 노래책에서 곡을 추출하므로 songId 가 없어도 통과.
    // 일반 신청은 노래책 매칭된 songId 필요.
    if (!isRandomRequest && typeof dto.songId !== 'number') {
      throw new BadRequestException('공개 신청은 노래책 곡만 허용됩니다.');
    }

    // Trust boundary: donation metadata (source=DONATION, donationAmount, native pair)
    // must only be set by trusted internal callers. The public/console routes pass
    // isInternalRequest=false, so a malicious client could otherwise submit
    // source=DONATION + fake donationAmount to bypass donation-only gating and
    // minimum-price enforcement. Internal dispatcher path (isInternalRequest=true)
    // is the only trusted source of donation-originated requests.
    const isTrusted = isInternalRequest === true;
    const source = isTrusted ? dto.source || 'MANUAL' : 'MANUAL';
    const donationAmount = isTrusted ? dto.donationAmount : undefined;
    const donationNativeAmount = isTrusted
      ? dto.donationNativeAmount
      : undefined;
    const donationCurrency = isTrusted ? dto.donationCurrency : undefined;

    // 비신뢰 경로에서 위조 시도(필드가 실제로 들어왔으나 strip된 경우)를 메트릭으로 가시화.
    // dispatcher가 호출하는 internal 경로는 정당하므로 제외.
    if (!isTrusted) {
      const entrypoint = isConsoleRequest === true ? 'console' : 'public';
      const stripped: Array<
        | 'source'
        | 'donationAmount'
        | 'donationNativeAmount'
        | 'donationCurrency'
      > = [];
      if (dto.source && dto.source !== 'MANUAL') stripped.push('source');
      if (dto.donationAmount !== undefined) stripped.push('donationAmount');
      if (dto.donationNativeAmount !== undefined)
        stripped.push('donationNativeAmount');
      if (dto.donationCurrency !== undefined) stripped.push('donationCurrency');
      for (const field of stripped) {
        this.metricsService.songRequestUntrustedPayloadStrippedTotal.inc({
          field,
          entrypoint,
        });
      }
    }

    // Trust boundary: requester identity. 공개 경로는 클라이언트가 보낸
    // requesterPlatformId/requesterNickname을 그대로 신뢰하면 임의 유저 사칭,
    // maxRequestsPerUser 우회, 중복방지 회피가 가능하므로 서버가 권위적으로 결정.
    // - internal(chat-dispatcher): DTO 값 신뢰 (플랫폼 채팅 이벤트 기반)
    // - 콘솔 토큰(isConsoleRequest=true): ConsoleTokenGuard가 채널 운영자 권한을
    //   사전 확인했으므로 DTO 값 신뢰. 운영자가 대신 입력하는 "신청자 정보"이므로
    //   서버가 재구성하면 안 됨 (닉네임/플랫폼 ID를 운영자 스스로 정의함).
    // - 로그인 웹 (운영자 포함): userId 기반 서버 생성 — allowManualBypass=true여도
    //   공개 엔드포인트에서는 identity를 재구성해야 사칭 방지. 운영자는 자기 자신의
    //   닉네임으로 기록된다.
    // - 비로그인 웹: 익명 신청 설정 + 입력 닉네임 조합으로 서버 생성
    //
    // Donation trust(source/donationAmount)는 여전히 isTrusted만 신뢰.
    // 콘솔 경로는 source=MANUAL 강제되어 fake donation 주입 불가.
    const isTrustedIdentity = isTrusted || isConsoleRequest === true;
    let requesterPlatformId: string;
    let requesterNickname: string;
    let isAnonymous = false;
    if (isTrustedIdentity) {
      if (!dto.requesterPlatformId || !dto.requesterNickname) {
        throw new BadRequestException(
          'requesterPlatformId/requesterNickname이 필요합니다.',
        );
      }
      requesterPlatformId = dto.requesterPlatformId;
      requesterNickname = dto.requesterNickname;
    } else if (typeof requestUserId === 'number') {
      const user = await this.prisma.user.findUnique({
        where: { id: requestUserId },
        select: { nickname: true },
      });
      if (!user) {
        throw new BadRequestException('사용자를 찾을 수 없습니다.');
      }
      requesterPlatformId = `web_${requestUserId}`;
      requesterNickname = user.nickname;
    } else {
      // 익명 경로 — 표준 세션은 채널 설정, Sync 세션은 세션 설정을 기준으로
      // allowAnonymous / requestMode 를 판단한다.
      const liveWithChannel = await this.prisma.liveSession.findUnique({
        where: { id: dto.liveSessionId },
        select: {
          sessionType: true,
          settings: {
            select: { allowAnonymous: true, requestMode: true },
          },
          channel: {
            select: {
              songRequestSettings: {
                select: { allowAnonymous: true, requestMode: true },
              },
            },
          },
        },
      });
      const channelSettings = liveWithChannel?.channel?.songRequestSettings;
      const requestMode =
        liveWithChannel?.sessionType === LiveSessionType.SYNC
          ? liveWithChannel.settings?.requestMode
          : channelSettings?.requestMode;
      const allowAnonymous =
        liveWithChannel?.sessionType === LiveSessionType.SYNC
          ? liveWithChannel.settings?.allowAnonymous
          : channelSettings?.allowAnonymous;
      if (requestMode === 'VERIFIED_ONLY') {
        throw new BadRequestException('본인인증 회원만 신청 가능합니다.');
      }
      if (requestMode === 'CHAT_ONLY') {
        throw new BadRequestException('채팅에서만 신청 가능합니다.');
      }
      if (!allowAnonymous) {
        throw new BadRequestException('로그인이 필요합니다.');
      }
      const trimmed = dto.anonymousNickname?.trim() ?? '';
      if (!trimmed) {
        throw new BadRequestException('닉네임을 입력해 주세요.');
      }
      if (trimmed.length > 20) {
        throw new BadRequestException('닉네임은 20자 이하여야 합니다.');
      }
      if (!clientIp) {
        throw new BadRequestException(
          '클라이언트 IP를 확인할 수 없어 익명 신청을 처리할 수 없습니다.',
        );
      }
      requesterPlatformId = this.buildAnonymousPlatformId(clientIp);
      requesterNickname = `익명 (웹신청) ${trimmed}`;
      isAnonymous = true;
    }

    // position/afterRequestId는 운영자(MANUAL bypass) 경로에서만 적용한다.
    // 일반 사용자 신청은 항상 BACK으로 강제하여 임의 끼워넣기를 막는다.
    const insertPosition =
      allowManualBypass === true ? dto.position : undefined;
    const insertAfterRequestId =
      allowManualBypass === true ? dto.afterRequestId : undefined;

    const created = await this.queueService.addToQueue(dto.liveSessionId, {
      songId: dto.songId,
      rawArtist: dto.rawArtist,
      rawTitle: dto.rawTitle,
      rawMessage: dto.rawMessage,
      requesterPlatformId,
      requesterNickname,
      source,
      donationAmount,
      donationNativeAmount,
      donationCurrency,
      requestUserId,
      isInternalRequest,
      allowManualBypass,
      isAnonymous,
      insertPosition,
      insertAfterRequestId,
      requestType,
      sourceChannelId: dto.sourceChannelId,
      allowPublicWebRandomBypass: false,
    });

    if (
      typeof (created as SongRequestWithFormattedPrice).formattedPrice ===
      'string'
    ) {
      return created as SongRequestWithFormattedPrice;
    }

    const pricingContext = await this.buildPricingContext(
      created.liveSessionId,
    );
    return this.withFormattedPrice(
      created as SongRequestWithSong,
      pricingContext,
    );
  }

  /**
   * 익명 신청자의 requesterPlatformId를 IP + 서버 salt로 해시하여 생성.
   * - VARCHAR(64) 길이 맞춤: "anon_" 프리픽스(5) + hex 48자 = 53자
   * - ANON_IP_SALT는 bootstrap 시점에 필수로 검증됨 (main.ts validateRequiredEnv).
   *   test env만 fallback 허용 — prod/qa/dev는 Vault에 유니크 salt 설정 필수.
   * - maxRequestsPerUser/preventDuplicate 스코프 식별자로도 동작
   */
  private buildAnonymousPlatformId(ip: string): string {
    const salt = process.env.ANON_IP_SALT;
    if (!salt || salt.length < 16) {
      if (process.env.NODE_ENV !== 'test') {
        // bootstrap 검증을 통과했어야 함. 여기 도달하면 런타임에 env가 바뀐 것 — fail hard.
        throw new Error(
          'ANON_IP_SALT 누락 또는 너무 짧음 (16자 이상 필요). 서버를 재시작하고 env를 확인하세요.',
        );
      }
      // test env: 고정 dummy salt로 결정론적 동작 보장
      const testSalt = 'test-env-anon-salt-do-not-use-in-prod';
      const hash = createHash('sha256')
        .update(`${ip}:${testSalt}`)
        .digest('hex');
      return `anon_${hash.slice(0, 48)}`;
    }
    const hash = createHash('sha256').update(`${ip}:${salt}`).digest('hex');
    return `anon_${hash.slice(0, 48)}`;
  }

  /**
   * 신청곡의 상태를 변경합니다.
   */
  async updateStatus(
    requestId: number,
    dto: UpdateSongRequestStatusDto,
  ): Promise<SongRequestWithFormattedPrice> {
    const existingRequest = await this.prisma.songRequest.findUnique({
      where: { id: requestId },
    });

    if (!existingRequest) {
      throw new NotFoundException('신청곡을 찾을 수 없습니다.');
    }

    const updateData = this.buildStatusUpdateData(existingRequest, dto);

    // 상태 변경 + revision bump 를 한 트랜잭션으로 co-commit (GATE 0).
    const updatedRequest = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.songRequest.update({
        where: { id: requestId },
        data: updateData,
        select: songRequestWithSongSelect,
      });
      await enqueuePlaybackRevision(tx, existingRequest.liveSessionId, {
        commandType: 'song_request.status_changed',
        causationRequestId: requestId,
      });
      return updated;
    });
    const updatedRequestWithFormattedPrice =
      await this.formatRequestWithPrice(updatedRequest);
    this.emitStatusTransition(
      existingRequest.status,
      dto.status,
      updatedRequestWithFormattedPrice,
    );

    return updatedRequestWithFormattedPrice;
  }

  /**
   * 신청곡을 삭제합니다.
   */
  async deleteRequest(requestId: number): Promise<void> {
    const existingRequest = await this.prisma.songRequest.findUnique({
      where: { id: requestId },
    });

    if (!existingRequest) {
      throw new NotFoundException('신청곡을 찾을 수 없습니다.');
    }

    await this.queueService.removeFromQueue(requestId);
  }

  /**
   * 본인이 신청한 PENDING 상태의 신청곡을 취소합니다.
   */
  async cancelMyRequest(requestId: number, userId: number): Promise<void> {
    const request = await this.prisma.songRequest.findUnique({
      where: { id: requestId },
      select: { id: true, requestUserId: true, status: true },
    });

    if (!request) {
      throw new NotFoundException('신청곡을 찾을 수 없습니다.');
    }

    if (request.requestUserId !== userId) {
      throw new ForbiddenException('본인의 신청곡만 취소할 수 있습니다.');
    }

    if (request.status !== SongRequestStatus.PENDING) {
      throw new BadRequestException('대기 중인 신청곡만 취소할 수 있습니다.');
    }

    await this.queueService.removeFromQueue(requestId);
  }

  /**
   * 신청곡 ID로 조회합니다.
   */
  async findById(requestId: number): Promise<SongRequestWithFormattedPrice> {
    const request = await this.prisma.songRequest.findUnique({
      where: { id: requestId },
      select: songRequestWithSongSelect,
    });

    if (!request) {
      throw new NotFoundException('신청곡을 찾을 수 없습니다.');
    }

    const pricingContext = await this.buildPricingContext(
      request.liveSessionId,
    );
    return this.withFormattedPrice(request, pricingContext);
  }

  /**
   * 대기열 순서를 변경합니다.
   */
  async updateQueueOrder(requestId: number, newOrder: number): Promise<void> {
    const existingRequest = await this.prisma.songRequest.findUnique({
      where: { id: requestId },
    });

    if (!existingRequest) {
      throw new NotFoundException('신청곡을 찾을 수 없습니다.');
    }

    await this.queueService.updateOrder(requestId, newOrder);
  }

  /**
   * 현재 재생 중인 곡을 조회합니다.
   */
  async getNowPlaying(
    liveSessionId: number,
  ): Promise<SongRequestWithFormattedPrice | null> {
    const playing = await this.prisma.songRequest.findFirst({
      where: {
        liveSessionId,
        status: SongRequestStatus.PLAYING,
      },
      // 일시적 중복 PLAYING 이 생겨도 결정적으로 같은 행을 고른다.
      orderBy: [{ playedAt: 'desc' }, { id: 'desc' }],
      select: songRequestWithSongSelect,
    });

    if (!playing) {
      return null;
    }

    const pricingContext = await this.buildPricingContext(liveSessionId);
    const priced = this.withFormattedPrice(playing, pricingContext);
    const [enriched] = await attachSyncRequestAvailableChannels(
      this.prisma,
      liveSessionId,
      [priced],
    );
    return enriched;
  }

  /**
   * 다음 곡을 재생합니다 (현재 곡 완료 처리 + 다음 곡 재생).
   */
  async playNext(
    liveSessionId: number,
  ): Promise<SongRequestWithFormattedPrice | null> {
    const hasAdvanceCooldown = await this.acquireAdvanceCooldown(
      liveSessionId,
      'play-next',
    );
    if (!hasAdvanceCooldown) {
      return this.getNowPlayingAfterIgnoredAdvance(liveSessionId);
    }

    const transition = await this.prisma.$transaction(async (tx) => {
      const session = await tx.liveSession.findUnique({
        where: { id: liveSessionId },
        select: { status: true },
      });
      if (!session || session.status !== 'ACTIVE') {
        return null;
      }

      const now = new Date();
      const currentPlaying = await tx.songRequest.findFirst({
        where: {
          liveSessionId,
          status: SongRequestStatus.PLAYING,
        },
        orderBy: [{ playedAt: 'desc' }, { id: 'desc' }],
        select: { id: true, status: true, playedAt: true },
      });
      const nextRequest = await tx.songRequest.findFirst({
        where: {
          liveSessionId,
          status: { in: NEXT_PLAYABLE_STATUSES },
        },
        orderBy: [{ priority: 'desc' }, { queueOrder: 'asc' }],
        select: { id: true, status: true, playedAt: true },
      });

      if (!nextRequest) {
        if (!currentPlaying) {
          return {
            completed: null,
            next: null,
          };
        }

        const current = await tx.songRequest.findUnique({
          where: { id: currentPlaying.id },
          select: songRequestWithSongSelect,
        });

        return {
          completed: null,
          next: current
            ? {
                oldStatus: currentPlaying.status,
                request: current,
                emit: false,
              }
            : null,
        };
      }

      const completedCurrent = currentPlaying
        ? await tx.songRequest.update({
            where: { id: currentPlaying.id },
            data: this.buildStatusUpdateData(
              currentPlaying,
              { status: SongRequestStatus.COMPLETED },
              now,
            ),
            select: songRequestWithSongSelect,
          })
        : null;

      const playingNext = await tx.songRequest.update({
        where: { id: nextRequest.id },
        data: this.buildStatusUpdateData(
          nextRequest,
          { status: SongRequestStatus.PLAYING },
          now,
        ),
        select: songRequestWithSongSelect,
      });

      // 현재 곡 완료 + 다음 곡 PLAYING 전이 → revision bump (GATE 0).
      await enqueuePlaybackRevision(tx, liveSessionId, {
        commandType: 'song_request.play_next',
        causationRequestId: nextRequest?.id ?? currentPlaying?.id ?? null,
      });

      return {
        completed: currentPlaying
          ? {
              oldStatus: currentPlaying.status,
              request: completedCurrent,
            }
          : null,
        next: {
          oldStatus: nextRequest.status,
          request: playingNext,
          emit: true,
        },
      };
    });

    if (!transition) {
      return null;
    }

    if (transition.completed?.request) {
      const completedRequest = await this.formatRequestWithPrice(
        transition.completed.request,
      );
      this.emitStatusTransition(
        transition.completed.oldStatus,
        SongRequestStatus.COMPLETED,
        completedRequest,
      );
    }

    if (!transition.next) {
      this.eventEmitter.emit(SONG_REQUEST_EVENTS.QUEUE_UPDATED, {
        liveSessionId,
        action: 'exhausted',
      });
      return null;
    }

    const playingRequest = await this.formatRequestWithPrice(
      transition.next.request,
    );
    if (transition.next.emit) {
      this.emitStatusTransition(
        transition.next.oldStatus,
        SongRequestStatus.PLAYING,
        playingRequest,
      );
    }

    return playingRequest;
  }

  /**
   * 현재 곡을 스킵합니다 (거절 처리 + 다음 곡 재생).
   */
  async skipCurrent(
    liveSessionId: number,
    reason?: string,
  ): Promise<SongRequestWithFormattedPrice | null> {
    const hasAdvanceCooldown = await this.acquireAdvanceCooldown(
      liveSessionId,
      'skip-current',
    );
    if (!hasAdvanceCooldown) {
      return this.getNowPlayingAfterIgnoredAdvance(liveSessionId);
    }

    const transition = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const session = await tx.liveSession.findUnique({
        where: { id: liveSessionId },
        select: { status: true },
      });
      const canAdvance = session?.status === 'ACTIVE';
      const currentPlaying = await tx.songRequest.findFirst({
        where: {
          liveSessionId,
          status: SongRequestStatus.PLAYING,
        },
        orderBy: [{ playedAt: 'desc' }, { id: 'desc' }],
        select: { id: true, status: true, playedAt: true },
      });
      const nextRequest = canAdvance
        ? await tx.songRequest.findFirst({
            where: {
              liveSessionId,
              status: { in: NEXT_PLAYABLE_STATUSES },
            },
            orderBy: [{ priority: 'desc' }, { queueOrder: 'asc' }],
            select: { id: true, status: true, playedAt: true },
          })
        : null;

      const rejectedCurrent = currentPlaying
        ? await tx.songRequest.update({
            where: { id: currentPlaying.id },
            data: this.buildStatusUpdateData(
              currentPlaying,
              {
                status: SongRequestStatus.REJECTED,
                rejectionReason: reason || '스킵됨',
              },
              now,
            ),
            select: songRequestWithSongSelect,
          })
        : null;

      // 현재 곡 거절 또는 다음 곡 재생 등 실제 상태 변경이 있을 때 revision bump (GATE 0).
      if (currentPlaying || nextRequest) {
        await enqueuePlaybackRevision(tx, liveSessionId, {
          commandType: 'song_request.skipped',
          causationRequestId: nextRequest?.id ?? currentPlaying?.id ?? null,
        });
      }

      if (!nextRequest) {
        return {
          canAdvance,
          rejected: currentPlaying
            ? {
                oldStatus: currentPlaying.status,
                request: rejectedCurrent,
              }
            : null,
          next: null,
        };
      }

      const playingNext = await tx.songRequest.update({
        where: { id: nextRequest.id },
        data: this.buildStatusUpdateData(
          nextRequest,
          { status: SongRequestStatus.PLAYING },
          now,
        ),
        select: songRequestWithSongSelect,
      });

      return {
        canAdvance,
        rejected: currentPlaying
          ? {
              oldStatus: currentPlaying.status,
              request: rejectedCurrent,
            }
          : null,
        next: {
          oldStatus: nextRequest.status,
          request: playingNext,
        },
      };
    });

    if (transition.rejected?.request) {
      const rejectedRequest = await this.formatRequestWithPrice(
        transition.rejected.request,
      );
      this.emitStatusTransition(
        transition.rejected.oldStatus,
        SongRequestStatus.REJECTED,
        rejectedRequest,
      );
    }

    if (!transition.next) {
      if (!transition.canAdvance) {
        return null;
      }
      this.eventEmitter.emit(SONG_REQUEST_EVENTS.QUEUE_UPDATED, {
        liveSessionId,
        action: 'exhausted',
      });
      return null;
    }

    const playingRequest = await this.formatRequestWithPrice(
      transition.next.request,
    );
    this.emitStatusTransition(
      transition.next.oldStatus,
      SongRequestStatus.PLAYING,
      playingRequest,
    );

    return playingRequest;
  }

  /**
   * 대기열을 초기화합니다 (모든 PENDING 상태 삭제).
   */
  async clearQueue(liveSessionId: number): Promise<number> {
    // 대기열 삭제 + revision bump 를 한 트랜잭션으로 co-commit (GATE 0).
    const result = await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.songRequest.deleteMany({
        where: {
          liveSessionId,
          status: SongRequestStatus.PENDING,
        },
      });
      await enqueuePlaybackRevision(tx, liveSessionId, {
        commandType: 'song_request.queue_cleared',
      });
      return deleted;
    });

    this.eventEmitter.emit(SONG_REQUEST_EVENTS.QUEUE_UPDATED, {
      liveSessionId,
      action: 'cleared',
    });

    return result.count;
  }

  /**
   * 특정 곡을 즉시 재생합니다 (대기열에서 꺼내서 재생).
   */
  async playNow(requestId: number): Promise<SongRequestWithFormattedPrice> {
    const targetSummary = await this.prisma.songRequest.findUnique({
      where: { id: requestId },
      select: { liveSessionId: true },
    });
    if (!targetSummary) {
      throw new NotFoundException('신청곡을 찾을 수 없습니다.');
    }

    const transition = await this.prisma.$transaction(async (tx) => {
      // playNow 는 사용자가 명시적으로 "이 곡 지금 재생" 을 누른 deliberate action 이므로
      // advance 쿨다운으로 조용히 무시(요청 곡이 PENDING 으로 남고, omakase 는 재화만
      // 소진)하면 안 된다. 동시 playNow / omakase 자동재생이 중복 PLAYING 을 만드는
      // 레이스는 세션 row 를 FOR UPDATE 로 잠가 직렬화해 막는다 (advance 는 저빈도라
      // 경합 없음). 마지막 playNow 가 이긴다.
      await tx.$queryRaw`SELECT id FROM live_sessions WHERE id = ${targetSummary.liveSessionId} FOR UPDATE`;

      const request = await tx.songRequest.findUnique({
        where: { id: requestId },
        select: {
          id: true,
          liveSessionId: true,
          status: true,
          playedAt: true,
        },
      });

      if (!request) {
        return null;
      }

      if (request.status === SongRequestStatus.PLAYING) {
        const current = await tx.songRequest.findUnique({
          where: { id: requestId },
          select: songRequestWithSongSelect,
        });
        return {
          completed: null,
          target: current
            ? {
                oldStatus: request.status,
                request: current,
                emit: false,
              }
            : null,
        };
      }

      const now = new Date();
      const currentPlaying = await tx.songRequest.findFirst({
        where: {
          liveSessionId: request.liveSessionId,
          status: SongRequestStatus.PLAYING,
          id: { not: requestId },
        },
        orderBy: [{ playedAt: 'desc' }, { id: 'desc' }],
        select: { id: true, status: true, playedAt: true },
      });

      const completedCurrent = currentPlaying
        ? await tx.songRequest.update({
            where: { id: currentPlaying.id },
            data: this.buildStatusUpdateData(
              currentPlaying,
              { status: SongRequestStatus.COMPLETED },
              now,
            ),
            select: songRequestWithSongSelect,
          })
        : null;

      const target = await tx.songRequest.update({
        where: { id: requestId },
        data: this.buildStatusUpdateData(
          request,
          { status: SongRequestStatus.PLAYING },
          now,
        ),
        select: songRequestWithSongSelect,
      });

      // 대상 곡 PLAYING 전이 (+ 이전 곡 완료) → revision bump (GATE 0).
      await enqueuePlaybackRevision(tx, request.liveSessionId, {
        commandType: 'song_request.play_now',
        causationRequestId: request.id,
      });

      return {
        completed: currentPlaying
          ? {
              oldStatus: currentPlaying.status,
              request: completedCurrent,
            }
          : null,
        target: {
          oldStatus: request.status,
          request: target,
          emit: true,
        },
      };
    });

    if (!transition?.target?.request) {
      throw new NotFoundException('신청곡을 찾을 수 없습니다.');
    }

    if (transition.completed?.request) {
      const completedRequest = await this.formatRequestWithPrice(
        transition.completed.request,
      );
      this.emitStatusTransition(
        transition.completed.oldStatus,
        SongRequestStatus.COMPLETED,
        completedRequest,
      );
    }

    const playingRequest = await this.formatRequestWithPrice(
      transition.target.request,
    );
    if (transition.target.emit) {
      this.emitStatusTransition(
        transition.target.oldStatus,
        SongRequestStatus.PLAYING,
        playingRequest,
      );
    }

    return playingRequest;
  }

  /**
   * 곡별 신청 통계를 조회합니다.
   */
  async getSongRequestStats(songId: number, channelId: number) {
    const result = await this.prisma.songRequest.aggregate({
      where: {
        songId,
        song: { channelId },
        status: { not: SongRequestStatus.REJECTED },
      },
      _count: { id: true },
      _max: { createdAt: true },
    });

    return {
      totalRequestCount: result._count.id,
      lastRequestedAt: result._max.createdAt?.toISOString() ?? null,
    };
  }

  /**
   * 채널×곡 단위로 신청 이력을 시간 역순으로 조회합니다.
   * - REJECTED 상태는 응답에서 제외
   * - 익명 신청은 닉네임이 '익명' 으로 마스킹
   * - 탈퇴 사용자의 신청은 닉네임이 '(탈퇴한 사용자)' 로 마스킹
   * - 페이지네이션은 page/limit 기반 (기본 1/20)
   */
  async getSongRequestHistory(query: {
    songId: number;
    channelId: number;
    page?: number;
    limit?: number;
  }): Promise<SongRequestHistoryResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where = {
      songId: query.songId,
      song: { channelId: query.channelId },
      status: { not: SongRequestStatus.REJECTED },
      source: { not: SongRequestSource.COMPETITOR },
    };

    const [rows, total] = await Promise.all([
      this.prisma.songRequest.findMany({
        where,
        select: {
          id: true,
          requesterNickname: true,
          isAnonymous: true,
          status: true,
          source: true,
          donationAmount: true,
          donationCurrency: true,
          createdAt: true,
          requestUser: { select: { deletedAt: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.songRequest.count({ where }),
    ]);

    const requests = rows.map((r) => {
      let displayNickname = r.requesterNickname;
      if (r.isAnonymous) {
        displayNickname = '익명';
      } else if (r.requestUser?.deletedAt) {
        displayNickname = '(탈퇴한 사용자)';
      }
      return {
        id: r.id,
        requesterNickname: displayNickname,
        isAnonymous: r.isAnonymous,
        status: r.status,
        source: r.source,
        donationAmount: r.donationAmount,
        donationCurrency: r.donationCurrency,
        createdAt: r.createdAt.toISOString(),
      };
    });

    return {
      requests,
      pagination: buildPaginationMeta(page, limit, total),
    };
  }

  /**
   * 세션에서 이미 신청된 곡 ID 목록을 조회합니다.
   */
  async getRequestedSongIds(sessionId: number) {
    const requests = await this.prisma.songRequest.findMany({
      where: {
        liveSessionId: sessionId,
        status: { not: SongRequestStatus.REJECTED },
        songId: { not: null },
      },
      select: { songId: true },
      distinct: ['songId'],
    });

    return {
      songIds: requests
        .map((r) => r.songId)
        .filter((id): id is number => id !== null),
    };
  }

  async getMyHistory(
    userId: number,
    opts: {
      page?: number;
      limit?: number;
      status?: string[];
      source?: string[];
      startDate?: string;
      endDate?: string;
      search?: string;
    } = {},
  ) {
    const page = opts.page ?? 1;
    const limit = opts.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: any = {
      OR: [
        { requestUserId: userId },
        { requesterPlatformId: `web_${userId}`, requestUserId: null },
      ],
      source: { not: SongRequestSource.COMPETITOR },
    };

    if (opts.status?.length) {
      where.status = { in: opts.status };
    }
    if (opts.source?.length) {
      where.source = { ...where.source, in: opts.source };
    }
    if (opts.startDate || opts.endDate) {
      where.createdAt = {};
      if (opts.startDate) {
        where.createdAt.gte = new Date(opts.startDate);
      }
      if (opts.endDate) {
        const end = new Date(opts.endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }
    if (opts.search?.trim()) {
      const term = opts.search.trim();
      where.AND = [
        {
          OR: [
            { rawTitle: { contains: term } },
            { rawArtist: { contains: term } },
          ],
        },
      ];
    }

    const [requests, total] = await Promise.all([
      this.prisma.songRequest.findMany({
        where,
        select: songRequestHistorySelect,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.songRequest.count({ where }),
    ]);

    return {
      requests: requests.map(({ liveSession, ...rest }) => ({
        ...rest,
        session: liveSession,
      })),
      pagination: buildPaginationMeta(page, limit, total),
    };
  }

  private buildStatusUpdateData(
    existingRequest: StatusTransitionSource,
    dto: UpdateSongRequestStatusDto,
    now = new Date(),
  ): any {
    const updateData: any = {
      status: dto.status,
    };

    if (dto.status === SongRequestStatus.PLAYING) {
      updateData.playedAt = now;
    } else if (dto.status === SongRequestStatus.COMPLETED) {
      updateData.completedAt = now;
      if (!existingRequest.playedAt) {
        updateData.playedAt = now;
      }
    } else if (dto.status === SongRequestStatus.REJECTED) {
      updateData.rejectionReason = dto.rejectionReason;
    }

    return updateData;
  }

  private async formatRequestWithPrice(
    request: SongRequestWithSong,
  ): Promise<SongRequestWithFormattedPrice> {
    const pricingContext = await this.buildPricingContext(
      request.liveSessionId,
    );
    const priced = this.withFormattedPrice(request, pricingContext);
    const [enriched] = await attachSyncRequestAvailableChannels(
      this.prisma,
      request.liveSessionId,
      [priced],
    );
    return enriched;
  }

  private emitStatusTransition(
    oldStatus: SongRequestStatus,
    newStatus: SongRequestStatus,
    request: SongRequestWithFormattedPrice,
  ): void {
    this.metricsService.songRequestStatusTransitionsTotal.inc({
      from_status: oldStatus,
      to_status: newStatus,
    });

    this.eventEmitter.emit(SONG_REQUEST_EVENTS.STATUS_CHANGED, {
      requestId: request.id,
      oldStatus,
      newStatus,
      request,
    });

    switch (newStatus) {
      case SongRequestStatus.ACCEPTED:
        this.eventEmitter.emit(SONG_REQUEST_EVENTS.ACCEPTED, request);
        break;
      case SongRequestStatus.REJECTED:
        this.eventEmitter.emit(SONG_REQUEST_EVENTS.REJECTED, request);
        break;
      case SongRequestStatus.PLAYING:
        this.eventEmitter.emit(SONG_REQUEST_EVENTS.PLAYING, request);
        break;
      case SongRequestStatus.COMPLETED:
        this.eventEmitter.emit(SONG_REQUEST_EVENTS.COMPLETED, request);
        break;
    }
  }

  private async buildPricingContext(liveSessionId: number): Promise<{
    platform: StreamPlatform | null | undefined;
    currencyConfigs: CurrencyConfig[];
  }> {
    const session = await this.prisma.liveSession.findUnique({
      where: { id: liveSessionId },
      select: {
        channelId: true,
        platform: true,
      },
    });

    if (!session) {
      return {
        platform: undefined,
        currencyConfigs: [],
      };
    }

    const pricingSettings = await this.songPricingService.getPricingSettings(
      session.channelId,
    );
    const pricingData =
      this.songPricingService.extractPricingData(pricingSettings);

    return {
      platform: session.platform,
      currencyConfigs: pricingData.currencyConfigs,
    };
  }

  private withFormattedPrice(
    request: SongRequestWithSong,
    context: {
      platform: StreamPlatform | null | undefined;
      currencyConfigs: CurrencyConfig[];
    },
  ): SongRequestWithFormattedPrice {
    return {
      ...request,
      formattedPrice: this.songPricingService.formatCalculatedPrice(
        request.calculatedPrice,
        context.platform,
        context.currencyConfigs,
      ),
    };
  }
}
