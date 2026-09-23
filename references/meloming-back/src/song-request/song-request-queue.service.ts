import { Injectable, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import {
  Prisma,
  SongRequestStatus,
  SongRequestSource,
  SongRequestMode,
  SongRequestType,
  PriceSource,
  LiveSessionStatus,
  LiveSessionType,
  ChannelUserBlockFeature,
} from '@prisma/client';
import { songRequestWithSongSelect } from './prisma/song-request.selections';
import { SONG_REQUEST_EVENTS } from './events/song-request.events';
import { SongMatcherService, SongMatchResult } from './song-matcher.service';
import { SongPricingService } from '../song-pricing/song-pricing.service';
import { MetricsService } from '../metrics';
import {
  lookupExchangeRate,
  UnknownCurrencyError,
  compareAmounts,
} from '../song-pricing/utils/platform-exchange.util';
import { CalculatedPriceResult } from '../song-pricing/types/pricing.types';
import { SongRequestUserBlockService } from './song-request-user-block.service';
import { ChannelSongRequestSettingsService } from '../channel/channel-song-request-settings.service';
import { mergeEffectiveSongRequestSettings } from '../song-live/effective-song-request-settings';
import { attachSyncRequestAvailableChannels } from './sync-request-available-channels';
import {
  escapeForLike,
  normalizeForSearch,
} from '../song/utils/search-normalize';
import { enqueuePlaybackRevision } from '../overlay-playback/bump-playback-revision';

@Injectable()
export class SongRequestQueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly songMatcherService: SongMatcherService,
    private readonly songPricingService: SongPricingService,
    private readonly metricsService: MetricsService,
    private readonly userBlockService: SongRequestUserBlockService,
    private readonly channelSongRequestSettingsService: ChannelSongRequestSettingsService,
  ) {}

  /**
   * 대기열에 신청곡을 추가합니다.
   * 우선순위는 후원 금액 기반으로 자동 계산됩니다.
   * 노래책 매칭을 시도하고 설정에 따라 처리합니다.
   */
  async addToQueue(
    liveSessionId: number,
    requestData: {
      songId?: number;
      rawArtist: string;
      rawTitle: string;
      rawMessage?: string;
      requesterPlatformId: string;
      requesterNickname: string;
      source: string;
      donationAmount?: number;
      /** 플랫폼 고유 재화 수량 (예: 별풍선 2개 → 2). donationCurrency와 함께 사용. */
      donationNativeAmount?: number;
      /** 플랫폼 고유 재화 키 (예: 'SOOP_BALLOON', 'CHZZK_CHEESE'). donationNativeAmount와 함께 사용. */
      donationCurrency?: string;
      skipSongMatch?: boolean;
      allowManualBypass?: boolean;
      allowPublicWebRandomBypass?: boolean;
      requestUserId?: number;
      sourceChannelId?: number;
      streamMessageId?: string;
      isInternalRequest?: boolean;
      /** 공개 경로에서 비로그인 + allowAnonymous=true 로 받은 요청 여부. DB의 is_anonymous 컬럼에 저장. */
      isAnonymous?: boolean;
      /**
       * 대기열 삽입 위치 (운영자/MANUAL 경로 전용). 일반 사용자 신청은 항상 BACK.
       * - 'FRONT': 활성(REJECTED 제외) 곡 중 min(queueOrder)-1 자리에 삽입 → 다음 재생 위치.
       * - 'BACK' (기본): 활성 곡 중 max(queueOrder)+1 자리에 추가.
       * - 'AFTER': insertAfterRequestId 다음에 삽입. 같은 세션의 그보다 큰 queueOrder를
       *   transaction으로 +1 시프트한 뒤 새 row를 그 자리에 생성.
       */
      insertPosition?: 'FRONT' | 'BACK' | 'AFTER';
      /** insertPosition='AFTER' 일 때 직전 항목 ID. 같은 세션이어야 한다. */
      insertAfterRequestId?: number;
      /**
       * RANDOM 이면 채널 노래책에서 임의 1곡을 추출해 그 곡으로 신청을 만든다.
       * songId/rawArtist/rawTitle 은 무시되고 추출된 곡 기준으로 채워진다.
       * 추출 풀은 신청곡 기본 필터(blockedCategoryIds, preventDuplicateSongs)를 그대로 통과시킨다.
       */
      requestType?: SongRequestType;
    },
  ) {
    const requestType = requestData.requestType ?? SongRequestType.NORMAL;
    const isRandomRequest = requestType === SongRequestType.RANDOM;

    let rawArtist =
      this.normalizeOptionalText(requestData.rawArtist, 255) ?? '';
    let rawTitle = this.normalizeOptionalText(requestData.rawTitle, 255) ?? '';
    const randomFilter = isRandomRequest
      ? this.normalizeOptionalText(rawTitle || rawArtist, 255)
      : undefined;

    // 랜덤 신청은 곡 추출 후 raw 값이 채워지므로 빈 입력 허용. 일반 신청은 둘 중 하나 필수.
    if (!isRandomRequest && !rawArtist && !rawTitle) {
      throw new BadRequestException('아티스트명 또는 곡 제목을 입력해주세요.');
    }
    const rawMessage = this.normalizeOptionalText(requestData.rawMessage, 1000);
    const requesterPlatformId = this.normalizeRequiredText(
      requestData.requesterPlatformId,
      '신청자 플랫폼 ID',
      64,
    );
    const requesterNickname = this.normalizeRequiredText(
      requestData.requesterNickname,
      '신청자 닉네임',
      255,
    );

    // 세션 및 설정 조회
    const session = await this.prisma.liveSession.findUnique({
      where: { id: liveSessionId },
      include: { settings: true },
    });

    if (!session) {
      throw new BadRequestException('라이브 세션을 찾을 수 없습니다.');
    }

    if (session.status !== LiveSessionStatus.ACTIVE) {
      throw new BadRequestException('활성화된 라이브 세션이 아닙니다.');
    }

    const channelSettings =
      await this.channelSongRequestSettingsService.getByChannelId(
        session.channelId,
      );
    let settings = mergeEffectiveSongRequestSettings(
      session.settings,
      channelSettings,
    );
    if (session.sessionType === LiveSessionType.SYNC && session.settings) {
      settings = {
        ...settings,
        requestCommand: session.settings.requestCommand,
        maxQueueSize: session.settings.maxQueueSize,
        donationPriorityEnabled: session.settings.donationPriorityEnabled,
        enforceDonationMinimumPrice:
          session.settings.enforceDonationMinimumPrice,
        karaokePlaybackMode: session.settings.karaokePlaybackMode,
        karaokeVideoType: session.settings.karaokeVideoType,
        donationOnlyEnabled: session.settings.donationOnlyEnabled,
        requestMode: session.settings.requestMode,
        chatRequestEnabled: session.settings.chatRequestEnabled,
        donationRequestEnabled: session.settings.donationRequestEnabled,
        allowAnonymous: session.settings.allowAnonymous,
        requireSongMatch: session.settings.requireSongMatch,
        randomRequestEnabled: session.settings.randomRequestEnabled,
        preventDuplicateSongs: session.settings.preventDuplicateSongs,
        blockedCategoryIds: Array.isArray(session.settings.blockedCategoryIds)
          ? (session.settings.blockedCategoryIds as number[])
          : [],
        maxRequestsPerUser: session.settings.maxRequestsPerUser,
        maxTotalRequests: session.settings.maxTotalRequests,
        showRequesterName: session.settings.showRequesterName,
        syncChatRequestsEnabled: session.settings.syncChatRequestsEnabled,
        syncRandomSongCommand: session.settings.syncRandomSongCommand,
        syncRandomSongMinDonation: session.settings.syncRandomSongMinDonation,
        syncRandomStreamerCommand: session.settings.syncRandomStreamerCommand,
        syncRandomStreamerMinDonation:
          session.settings.syncRandomStreamerMinDonation,
      };
    }
    const source = requestData.source as SongRequestSource;
    const isManualSource = source === SongRequestSource.MANUAL;
    const allowManualBypass =
      isManualSource && requestData.allowManualBypass === true;
    const allowPublicWebRandomBypass =
      requestData.allowPublicWebRandomBypass === true;
    let resolvedRequestUserId = requestData.requestUserId ?? null;
    const sourceChannelId =
      session.sessionType === LiveSessionType.SYNC &&
      requestData.sourceChannelId != null
        ? Number(requestData.sourceChannelId)
        : session.channelId;

    if (session.sessionType === LiveSessionType.SYNC) {
      if (!sourceChannelId || !session.syncRoomId) {
        throw new BadRequestException('싱크 신청 채널 정보를 찾을 수 없습니다.');
      }
      const member = await this.prisma.syncRoomChannel.findUnique({
        where: {
          syncRoomId_channelId: {
            syncRoomId: session.syncRoomId,
            channelId: sourceChannelId,
          },
        },
        select: { id: true },
      });
      if (!member) {
        throw new BadRequestException(
          '싱크룸에 포함된 채널에서만 신청할 수 있습니다.',
        );
      }
    }

    if (
      !resolvedRequestUserId &&
      session.platform &&
      requesterPlatformId &&
      !requesterPlatformId.startsWith('anon_') &&
      !requesterPlatformId.startsWith('web_')
    ) {
      const platformVerification =
        await this.prisma.userPlatformVerification.findFirst({
          where: {
            platform: session.platform,
            platformUserId: requesterPlatformId.replace(/\(\d+\)$/, ''),
            isVerified: true,
          },
          select: { userId: true },
        });
      if (platformVerification) {
        resolvedRequestUserId = platformVerification.userId;
      }
    }

    const requestEnabled = settings?.requestEnabled ?? true;
    // requestEnabled(신청곡 기능 자체 ON/OFF)는 운영자도 우회 X.
    // OFF는 채널 소유자가 의도적으로 신청곡 기능을 비활성화한 상태이므로
    // 운영자(콘솔/매니저/관리자)가 직접 API를 호출해도 추가 불가하도록 정책 통일.
    // 일시정지(paused)와 달리 기능 자체가 꺼져 있는 상태는 우회 의미가 없다.
    if (!requestEnabled) {
      throw new BadRequestException('신청곡이 비활성화되어 있습니다.');
    }
    if (
      session.sessionType === LiveSessionType.SYNC &&
      !isRandomRequest &&
      settings.syncChatRequestsEnabled === false &&
      source === SongRequestSource.CHAT &&
      !allowManualBypass
    ) {
      throw new BadRequestException('싱크 채팅 신청이 비활성화되어 있습니다.');
    }
    if (settings?.paused && !allowManualBypass) {
      throw new BadRequestException('신청곡이 일시정지 상태입니다.');
    }

    // requestMode 검증
    const requestMode = settings?.requestMode ?? SongRequestMode.EVERYONE;
    const isInternal = requestData.isInternalRequest === true;
    const isAnonymousRequest = requestData.isAnonymous === true;
    if (!allowManualBypass) {
      switch (requestMode) {
        case SongRequestMode.VERIFIED_ONLY:
          // 본인인증 회원만: 내부(디스패처) 요청 + 익명 웹요청 차단, 로그인+본인인증 필수
          if (isInternal) {
            throw new BadRequestException('본인인증 회원만 신청 가능합니다.');
          }
          if (isAnonymousRequest) {
            throw new BadRequestException('본인인증 회원만 신청 가능합니다.');
          }
          if (!resolvedRequestUserId) {
            throw new BadRequestException('로그인이 필요합니다.');
          }
          const requester = await this.prisma.user.findUnique({
            where: { id: resolvedRequestUserId },
            select: { isIdentityVerified: true },
          });
          if (!requester?.isIdentityVerified) {
            throw new BadRequestException('본인인증이 필요합니다.');
          }
          break;
        case SongRequestMode.CHAT_ONLY:
          // 채팅에서만: 공개 API(웹/앱) 요청 차단 (익명 포함)
          if (!isInternal) {
            throw new BadRequestException('채팅에서만 신청 가능합니다.');
          }
          break;
        case SongRequestMode.EVERYONE:
        default:
          // 비로그인/익명 진입점 결정은 service 레이어가 담당 (allowAnonymous 체크 + nickname 검증 + IP 해시).
          // queue 레이어에서는 isAnonymous=true로 내려왔는데 설정이 꺼진 경우만 최종 거부.
          if (isAnonymousRequest && !settings?.allowAnonymous) {
            throw new BadRequestException(
              '이 채널은 익명 신청을 허용하지 않습니다.',
            );
          }
          break;
      }
    }

    if (!allowManualBypass) {
      await this.userBlockService.assertRequesterAllowed({
        channelId: sourceChannelId,
        feature: ChannelUserBlockFeature.SONG_REQUEST,
        platform: session.platform ?? null,
        requesterPlatformId,
        requestUserId: resolvedRequestUserId,
      });
    }

    // donationOnlyEnabled 체크 (독립 토글, 기존 유지)
    if (
      settings?.donationOnlyEnabled &&
      source !== SongRequestSource.DONATION &&
      !allowManualBypass
    ) {
      throw new BadRequestException('후원 신청곡만 가능합니다.');
    }

    // source별 활성 여부 체크 (채팅/후원 독립 토글).
    // MANUAL(콘솔 수동 추가)는 bypass 대상이므로 allowManualBypass 케이스에서만 통과,
    // CHAT/DONATION은 각 토글이 false면 차단.
    if (!allowManualBypass) {
      const chatRequestEnabled = settings?.chatRequestEnabled ?? true;
      const donationRequestEnabled = settings?.donationRequestEnabled ?? true;
      if (source === SongRequestSource.CHAT && !chatRequestEnabled) {
        throw new BadRequestException('채팅 신청이 비활성화되어 있습니다.');
      }
      if (source === SongRequestSource.DONATION && !donationRequestEnabled) {
        throw new BadRequestException('후원 신청이 비활성화되어 있습니다.');
      }
    }

    // maxQueueSize(동시 대기열 슬롯)는 운영자가 우회 가능.
    // 일반 사용자 보호 한도일 뿐이고, 운영자가 수동으로 추가하는 곡까지 막을 이유는 없다.
    const maxQueueSize = settings?.maxQueueSize ?? 50;
    if (maxQueueSize > 0 && !allowManualBypass) {
      const queueCount = await this.prisma.songRequest.count({
        where: {
          liveSessionId,
          status: {
            in: [
              SongRequestStatus.PENDING,
              SongRequestStatus.ACCEPTED,
              SongRequestStatus.PLAYING,
            ],
          },
        },
      });
      if (queueCount >= maxQueueSize) {
        throw new BadRequestException('신청곡 대기열이 가득 찼습니다.');
      }
    }

    // 최대 누적 신청 곡수 제한
    const maxTotalRequests = settings?.maxTotalRequests ?? 50;
    if (maxTotalRequests > 0 && !allowManualBypass) {
      const totalCount = await this.prisma.songRequest.count({
        where: {
          liveSessionId,
          status: { not: SongRequestStatus.REJECTED },
        },
      });
      if (totalCount >= maxTotalRequests) {
        throw new BadRequestException(
          `이 세션의 최대 누적 신청 곡수(${maxTotalRequests}곡)에 도달했습니다.`,
        );
      }
    }

    const requireSongMatch = settings.requireSongMatch;
    let matchedSongId = requestData.songId;
    let matchResult: SongMatchResult | null = null;
    // 슬롯머신 후보 곡 (RANDOM 일 때만 채워짐). 이벤트 payload 에 일회성으로 동봉됨.
    let randomSlotCandidates: Array<{
      id: number;
      title: string;
      artistName: string;
      albumArt: string | null;
    }> | null = null;

    if (isRandomRequest) {
      // 랜덤 신청 허용 토글 가드. requestEnabled 와 같은 등급 (운영자도 우회 X) —
      // 채널 owner 가 콘솔에서 끈 상태면 랜덤 신청 일체 차단. 일반 신청 흐름은 영향 X.
      if (settings?.randomRequestEnabled === false) {
        throw new BadRequestException('이 채널은 랜덤 신청을 받지 않습니다.');
      }
      // 랜덤 신청: 채널 노래책에서 blockedCategoryIds + preventDuplicateSongs 적용한 풀에서
      // winner 1곡 + 슬롯머신 후보 19곡 (총 20곡) 추출. winner 만 DB 에 row 저장.
      // 추출 후 rawArtist/rawTitle 을 winner 기준으로 덮어쓴다. 사후 blockedCategory/duplicate
      // 검증은 풀에서 이미 걸렀으므로 자동 통과.
      const picked = await this.pickRandomEligibleSong({
        channelIds:
          session.sessionType === LiveSessionType.SYNC && session.syncRoomId
            ? await this.getSyncRoomChannelIds(session.syncRoomId)
            : [sourceChannelId],
        liveSessionId,
        blockedCategoryIds: (() => {
          const raw = settings?.blockedCategoryIds;
          return Array.isArray(raw) ? (raw as number[]) : [];
        })(),
        preventDuplicates: settings?.preventDuplicateSongs === true,
        randomFilter,
      });
      if (!picked) {
        throw new BadRequestException(
          randomFilter
            ? '해당 조건에서 랜덤 신청할 수 있는 곡이 없습니다. 노래책을 확인해주세요.'
            : '랜덤 신청할 수 있는 곡이 없습니다. 노래책을 확인해주세요.',
        );
      }
      matchedSongId = picked.winner.id;
      rawArtist = picked.winner.artistName;
      rawTitle = picked.winner.title;
      randomSlotCandidates = picked.candidates;
    } else {
      const shouldSkipSongMatch =
        requestData.skipSongMatch === true && !matchedSongId;

      if (shouldSkipSongMatch) {
        if (requireSongMatch && !allowManualBypass) {
          throw new BadRequestException(
            '노래책에 등록되지 않은 곡입니다. 노래책에 있는 곡만 신청 가능합니다.',
          );
        }
      } else if (!matchedSongId && (rawArtist || rawTitle)) {
        if (rawArtist && rawTitle) {
          // 아티스트 + 제목으로 매칭 (스왑 매칭 포함)
          matchResult = await this.songMatcherService.matchSong(
            sourceChannelId,
            rawArtist,
            rawTitle,
          );
        }

        // 아티스트+제목 매칭 실패 또는 아티스트 없이 키워드만 있는 경우
        if (!matchResult?.matched) {
          const keyword = rawTitle || rawArtist;
          const keywordResult = await this.songMatcherService.matchByKeyword(
            sourceChannelId,
            keyword,
          );
          if (keywordResult.matched) {
            matchResult = keywordResult;
          } else if (!matchResult) {
            matchResult = keywordResult;
          }
        }

        if (matchResult?.matched && matchResult.song) {
          matchedSongId = matchResult.song.id;
        } else if (requireSongMatch) {
          // 노래책 매칭 필수인데 매칭 실패
          throw new BadRequestException(
            '노래책에 등록되지 않은 곡입니다. 노래책에 있는 곡만 신청 가능합니다.',
          );
        }
      }
    }

    // 신청 불가 카테고리 검증
    const blockedCategoryIds = (() => {
      const raw = settings?.blockedCategoryIds;
      return Array.isArray(raw) ? (raw as number[]) : [];
    })();
    if (matchedSongId && blockedCategoryIds.length > 0 && !allowManualBypass) {
      const songCategories = await this.prisma.songCategory.findMany({
        where: { songId: matchedSongId },
        select: { categoryId: true },
      });
      const blocked = songCategories.some((sc) =>
        blockedCategoryIds.includes(sc.categoryId),
      );
      if (blocked) {
        throw new BadRequestException('신청이 제한된 카테고리의 곡입니다');
      }
    }

    // 동일 곡 중복 신청 방지
    if (settings?.preventDuplicateSongs && !allowManualBypass) {
      const duplicateWhere: Prisma.SongRequestWhereInput = {
        liveSessionId,
        status: { not: SongRequestStatus.REJECTED },
        ...(matchedSongId
          ? { songId: matchedSongId }
          : { rawArtist, rawTitle }),
      };

      const existingRequest = await this.prisma.songRequest.findFirst({
        where: duplicateWhere,
        select: { id: true },
      });

      if (existingRequest) {
        throw new BadRequestException(
          `이미 신청된 곡입니다: ${rawArtist} - ${rawTitle}`,
        );
      }
    }

    // 1인당 신청 곡수 제한
    const maxRequestsPerUser = settings?.maxRequestsPerUser ?? 0;
    if (maxRequestsPerUser > 0 && !allowManualBypass) {
      const userRequestCount = await this.prisma.songRequest.count({
        where: {
          liveSessionId,
          requesterPlatformId,
          status: { not: SongRequestStatus.REJECTED },
        },
      });

      if (userRequestCount >= maxRequestsPerUser) {
        throw new BadRequestException(
          `1인당 최대 ${maxRequestsPerUser}곡까지 신청할 수 있습니다.`,
        );
      }
    }

    // 삽입 위치 결정.
    // - BACK (기본): 활성(REJECTED 제외) 곡 중 max(queueOrder)+1. 모든 곡이 완료된
    //   상태에서도 COMPLETED/PLAYING을 같이 보므로 충돌하지 않는다.
    // - FRONT: 활성 곡 중 min(queueOrder)-1. PLAYING이 있을 때 PLAYING 보다 더 앞이
    //   될 수 있으나, 정렬은 status 우선이므로 다음 재생 위치로 동작한다.
    // - AFTER: insertAfterRequestId 의 queueOrder + 1 자리. 그 이상의 모든 row를
    //   transaction으로 +1 시프트한 뒤 새 row를 생성한다.
    const insertPosition = requestData.insertPosition ?? 'BACK';
    let nextOrder: number;
    let needsAfterShift = false;

    if (insertPosition === 'AFTER') {
      if (!requestData.insertAfterRequestId) {
        throw new BadRequestException(
          'AFTER 위치 삽입에는 insertAfterRequestId가 필요합니다.',
        );
      }
      const after = await this.prisma.songRequest.findUnique({
        where: { id: requestData.insertAfterRequestId },
        select: { queueOrder: true, liveSessionId: true },
      });
      if (!after || after.liveSessionId !== liveSessionId) {
        throw new BadRequestException('AFTER 기준 신청곡을 찾을 수 없습니다.');
      }
      nextOrder = after.queueOrder + 1;
      needsAfterShift = true;
    } else if (insertPosition === 'FRONT') {
      const minRow = await this.prisma.songRequest.findFirst({
        where: {
          liveSessionId,
          status: { not: SongRequestStatus.REJECTED },
        },
        orderBy: { queueOrder: 'asc' },
        select: { queueOrder: true },
      });
      nextOrder = minRow ? minRow.queueOrder - 1 : 1;
    } else {
      const lastRequest = await this.prisma.songRequest.findFirst({
        where: {
          liveSessionId,
          status: { not: SongRequestStatus.REJECTED },
        },
        orderBy: { queueOrder: 'desc' },
        select: { queueOrder: true },
      });
      nextOrder = lastRequest ? lastRequest.queueOrder + 1 : 1;
    }

    // 후원 재화 정규화: native 우선, 없으면 KRW_LEGACY fallback
    const donationPair = this.resolveDonationPair(requestData);

    if (
      session.sessionType === LiveSessionType.SYNC &&
      isRandomRequest &&
      !allowManualBypass &&
      !allowPublicWebRandomBypass &&
      donationPair.amount < settings.syncRandomSongMinDonation
    ) {
      throw new BadRequestException(
        `싱크 랜덤 신청은 ${settings.syncRandomSongMinDonation}개 이상 후원해야 합니다.`,
      );
    }

    // Unknown currencyKey 검증 + 단일 환율 스냅샷 취득 (레이스 방지)
    let donationRate;
    try {
      donationRate = lookupExchangeRate(donationPair.currencyKey);
    } catch (err) {
      if (err instanceof UnknownCurrencyError) {
        this.metricsService.melomingChatUnknownCurrencyTotal.inc({
          source: 'queue',
        });
        throw new BadRequestException(
          `지원하지 않는 후원 재화입니다: ${donationPair.currencyKey}`,
        );
      }
      throw err;
    }

    // KRW snapshot 계산 (우선순위 계산 + DB 저장 공통 사용)
    // 단일 rate 스냅샷으로 계산 — nativeToKrw 별도 호출 없음
    const donationAmountKrw =
      donationPair.amount > 0
        ? donationPair.amount * donationRate.krwPerUnit
        : 0;

    const priority =
      settings?.donationPriorityEnabled === false
        ? 0
        : this.calculatePriority(donationAmountKrw);

    // DB 저장용 native 필드 결정
    let donationNativeAmountValue: number | null = null;
    let donationCurrencyValue: string | null = null;
    let donationRateVersionValue: number | null = null;

    if (donationPair.amount > 0) {
      if (donationPair.currencyKey === 'KRW_LEGACY') {
        // 레거시 KRW-only 요청: donationCurrency를 'KRW_LEGACY'로 태깅해
        // backfill이 매번 재처리하지 않도록 한다. native/rateVersion은 null 유지.
        donationCurrencyValue = 'KRW_LEGACY';
      } else {
        donationNativeAmountValue = donationPair.amount;
        donationCurrencyValue = donationPair.currencyKey;
        donationRateVersionValue = donationRate.version;
      }
    }

    // 가격 계산 (songId가 있는 경우만)
    let calculatedPrice: number | null = null;
    let priceSource: PriceSource = PriceSource.FREE;
    let formattedPrice: string | null = null;
    let priceResult: CalculatedPriceResult | null = null;

    if (matchedSongId) {
      priceResult = await this.songPricingService.calculatePrice(
        matchedSongId,
        sourceChannelId,
      );
      calculatedPrice = priceResult.price;
      priceSource = priceResult.source;
      formattedPrice = priceResult.formattedPrice;
    }

    // 최소 후원 금액 검증 (enforceDonationMinimumPrice) — currency-aware
    const enforceDonationMinimumPrice =
      settings?.enforceDonationMinimumPrice ?? true;
    if (
      enforceDonationMinimumPrice &&
      !allowManualBypass &&
      donationPair.amount > 0 &&
      calculatedPrice != null &&
      calculatedPrice > 0 &&
      compareAmounts(donationPair, {
        amount: calculatedPrice,
        currencyKey: priceResult?.currencyKey ?? 'KRW_LEGACY',
      }) < 0
    ) {
      const displayPrice =
        (formattedPrice && formattedPrice.trim()) ||
        `${calculatedPrice.toLocaleString()}`;
      throw new BadRequestException(
        `최소 후원 금액 ${displayPrice} 이상 필요합니다.`,
      );
    }

    const createData: Prisma.SongRequestUncheckedCreateInput = {
      liveSessionId,
      songId: matchedSongId,
      sourceChannelId:
        session.sessionType === LiveSessionType.SYNC ? sourceChannelId : null,
      rawArtist,
      rawTitle,
      rawMessage,
      requesterPlatformId,
      requesterNickname,
      source: source as any,
      donationAmount: donationAmountKrw > 0 ? donationAmountKrw : null,
      donationNativeAmount: donationNativeAmountValue,
      donationCurrency: donationCurrencyValue,
      donationRateVersion: donationRateVersionValue,
      priority,
      queueOrder: nextOrder,
      status: SongRequestStatus.PENDING,
      requestType,
      calculatedPrice,
      priceSource,
      requestUserId: resolvedRequestUserId,
      streamMessageId: requestData.streamMessageId,
      isAnonymous: isAnonymousRequest,
    };

    // 신청곡 생성 + revision bump 를 한 트랜잭션으로 co-commit (GATE 0).
    // AFTER 삽입은 queueOrder 시프트도 같은 트랜잭션에서 실행해 정렬 일관성 유지.
    const createdRequest = await this.prisma.$transaction(async (tx) => {
      if (needsAfterShift) {
        await tx.songRequest.updateMany({
          where: {
            liveSessionId,
            queueOrder: { gte: nextOrder },
          },
          data: { queueOrder: { increment: 1 } },
        });
      }
      const created = await tx.songRequest.create({
        data: createData,
        select: songRequestWithSongSelect,
      });
      await enqueuePlaybackRevision(tx, liveSessionId, {
        commandType: 'song_request.created',
        causationRequestId: created.id,
      });
      return created;
    });

    this.metricsService.songRequestsCreatedTotal.inc({
      platform: session.platform ?? session.sessionType,
      source: requestData.source || 'CHAT',
      bypass: allowManualBypass ? 'true' : 'false',
    });

    if (donationAmountKrw > 0) {
      this.metricsService.songRequestDonationAmountKrw.inc(
        { platform: session.platform ?? session.sessionType },
        donationAmountKrw,
      );
    }

    const createdRequestWithFormattedPrice = {
      ...createdRequest,
      formattedPrice: calculatedPrice == null ? '무료' : (formattedPrice ?? ''),
    };
    const [createdRequestForPayload] =
      session.sessionType === LiveSessionType.SYNC
        ? await attachSyncRequestAvailableChannels(this.prisma, liveSessionId, [
            createdRequestWithFormattedPrice,
          ])
        : [createdRequestWithFormattedPrice];

    // 이벤트 발행: 신청곡 생성 (매칭 결과 + 랜덤 슬롯 후보 포함)
    // randomSlotCandidates 는 RANDOM 신청 시 1회성. createdRequest 의 song 이 winner.
    this.eventEmitter.emit(SONG_REQUEST_EVENTS.CREATED, {
      ...createdRequestForPayload,
      matchResult: matchResult
        ? {
            matched: matchResult.matched,
            candidates: matchResult.candidates,
          }
        : null,
      randomSlotCandidates,
    });

    return createdRequestForPayload;
  }

  /**
   * 세션의 대기열을 조회합니다.
   * 우선순위 > 대기열 순서 순으로 정렬됩니다.
   */
  async getQueue(liveSessionId: number, includeCompleted = false) {
    const statusFilter = includeCompleted
      ? undefined
      : {
          in: [
            SongRequestStatus.PENDING,
            SongRequestStatus.ACCEPTED,
            SongRequestStatus.PLAYING,
          ],
        };

    const requests = await this.prisma.songRequest.findMany({
      where: {
        liveSessionId,
        source: { not: SongRequestSource.COMPETITOR },
        ...(statusFilter && { status: statusFilter }),
      },
      orderBy: [{ priority: 'desc' }, { queueOrder: 'asc' }],
      select: songRequestWithSongSelect,
    });

    return attachSyncRequestAvailableChannels(this.prisma, liveSessionId, requests);
  }

  /**
   * 대기열 순서를 변경합니다.
   *
   * @param newOrderInPending 대기열(PENDING/ACCEPTED) 내 1-based index.
   *   DB의 실제 queueOrder는 COMPLETED/PLAYING 곡의 최대 queueOrder를 더한 값.
   *   이 계약 덕분에 setlist에 완료곡이 쌓여 있어도 pending끼리의 재정렬이
   *   완료곡의 queueOrder를 건드리지 않아 setlist 히스토리가 깨지지 않는다.
   */
  async updateOrder(
    requestId: number,
    newOrderInPending: number,
  ): Promise<void> {
    const currentRequest = await this.prisma.songRequest.findUnique({
      where: { id: requestId },
      select: { queueOrder: true, liveSessionId: true, status: true },
    });

    if (!currentRequest) {
      throw new Error('요청을 찾을 수 없습니다.');
    }

    // 재정렬은 PENDING/ACCEPTED 곡만 허용. 이미 재생 중이거나 완료/거절된 곡의
    // queueOrder는 setlist 히스토리 용도라 바꾸면 안 된다.
    if (
      currentRequest.status !== SongRequestStatus.PENDING &&
      currentRequest.status !== SongRequestStatus.ACCEPTED
    ) {
      throw new BadRequestException(
        '대기 중인 신청곡만 순서를 변경할 수 있습니다.',
      );
    }

    const liveSessionId = currentRequest.liveSessionId;
    const oldOrder = currentRequest.queueOrder;

    // pending offset 계산: COMPLETED/PLAYING 최대 queueOrder 뒤에 pending 영역 시작.
    const maxCompletedOrPlaying = await this.prisma.songRequest.findFirst({
      where: {
        liveSessionId,
        status: {
          in: [SongRequestStatus.COMPLETED, SongRequestStatus.PLAYING],
        },
      },
      orderBy: { queueOrder: 'desc' },
      select: { queueOrder: true },
    });
    const baseOffset = maxCompletedOrPlaying?.queueOrder ?? 0;
    const actualNewOrder = baseOffset + newOrderInPending;

    if (oldOrder === actualNewOrder) {
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      if (actualNewOrder > oldOrder) {
        // 뒤로 이동: oldOrder < order <= actualNewOrder 인 PENDING/ACCEPTED를 -1
        await tx.songRequest.updateMany({
          where: {
            liveSessionId,
            status: {
              in: [SongRequestStatus.PENDING, SongRequestStatus.ACCEPTED],
            },
            queueOrder: {
              gt: oldOrder,
              lte: actualNewOrder,
            },
          },
          data: { queueOrder: { decrement: 1 } },
        });
      } else {
        // 앞으로 이동: actualNewOrder <= order < oldOrder 인 PENDING/ACCEPTED를 +1
        await tx.songRequest.updateMany({
          where: {
            liveSessionId,
            status: {
              in: [SongRequestStatus.PENDING, SongRequestStatus.ACCEPTED],
            },
            queueOrder: {
              gte: actualNewOrder,
              lt: oldOrder,
            },
          },
          data: { queueOrder: { increment: 1 } },
        });
      }

      await tx.songRequest.update({
        where: { id: requestId },
        data: { queueOrder: actualNewOrder },
      });

      // 대기열 재정렬 → revision bump (GATE 0).
      await enqueuePlaybackRevision(tx, liveSessionId, {
        commandType: 'song_request.reordered',
        causationRequestId: requestId,
      });
    });

    this.eventEmitter.emit(SONG_REQUEST_EVENTS.QUEUE_UPDATED, {
      liveSessionId,
      requestId,
      oldOrder,
      newOrder: actualNewOrder,
    });
  }

  private async getSyncRoomChannelIds(syncRoomId: number): Promise<number[]> {
    const members = await this.prisma.syncRoomChannel.findMany({
      where: { syncRoomId },
      select: { channelId: true },
      orderBy: { id: 'asc' },
    });
    return members.map((member) => member.channelId);
  }

  /**
   * 채널 노래책에서 랜덤 신청 가능한 곡 + 슬롯머신 후보 N곡을 추출한다.
   *
   * - blockedCategoryIds 에 속한 카테고리의 곡 제외
   * - preventDuplicateSongs=true 인 세션에서는 이미 신청된 곡(REJECTED 제외) 제외
   * - 풀 크기가 totalCount 보다 작으면 가능한 만큼만 반환 (최소 winner 1곡)
   *
   * 반환값:
   * - winner: 실제 신청될 곡 (DB 에 row 가 만들어지는 곡)
   * - candidates: 슬롯머신 시각화용 N곡. winner 포함, 셔플 상태. 일반 신청 흐름과
   *   같은 필터를 추출 단계에서 미리 적용하므로 사후 검증을 그대로 통과한다.
   */
  private async pickRandomEligibleSong(args: {
    channelIds: number[];
    liveSessionId: number;
    blockedCategoryIds: number[];
    preventDuplicates: boolean;
    /** `!랜덤신청 발라드` 처럼 채팅 명령 뒤에 붙은 카테고리/가수 필터. */
    randomFilter?: string;
    /** 슬롯머신 후보 전체 곡 수 (winner 포함). 기본 20. */
    totalCount?: number;
  }): Promise<{
    winner: {
      id: number;
      title: string;
      artistName: string;
      albumArt: string | null;
    };
    candidates: Array<{
      id: number;
      title: string;
      artistName: string;
      albumArt: string | null;
    }>;
  } | null> {
    const {
      channelIds,
      liveSessionId,
      blockedCategoryIds,
      preventDuplicates,
      randomFilter,
      totalCount = 20,
    } = args;

    const uniqueChannelIds = [...new Set(channelIds)].filter(
      (id) => Number.isInteger(id) && id > 0,
    );
    if (uniqueChannelIds.length === 0) {
      return null;
    }

    const where: Prisma.SongWhereInput = { channelId: { in: uniqueChannelIds } };

    const normalizedRandomFilter = normalizeForSearch(randomFilter);
    if (normalizedRandomFilter) {
      const categories = await this.prisma.category.findMany({
        where: { channelId: { in: uniqueChannelIds } },
        select: { id: true, name: true },
      });
      const matchedCategoryIds = categories
        .filter((category) =>
          normalizeForSearch(category.name).includes(normalizedRandomFilter),
        )
        .map((category) => category.id);

      const filterOr: Prisma.SongWhereInput[] = [
        {
          artist: {
            nameSearchable: { contains: escapeForLike(normalizedRandomFilter) },
          },
        },
      ];
      if (matchedCategoryIds.length > 0) {
        filterOr.push({
          songCategories: {
            some: { categoryId: { in: matchedCategoryIds } },
          },
        });
      }
      where.OR = filterOr;
    }

    if (blockedCategoryIds.length > 0) {
      where.NOT = {
        songCategories: {
          some: { categoryId: { in: blockedCategoryIds } },
        },
      };
    }

    if (preventDuplicates) {
      const alreadyRequested = await this.prisma.songRequest.findMany({
        where: {
          liveSessionId,
          status: { not: SongRequestStatus.REJECTED },
          songId: { not: null },
        },
        select: { songId: true },
        distinct: ['songId'],
      });
      const excludeIds = alreadyRequested
        .map((r) => r.songId)
        .filter((id): id is number => id !== null);
      if (excludeIds.length > 0) {
        where.id = { notIn: excludeIds };
      }
    }

    const total = await this.prisma.song.count({ where });
    if (total === 0) {
      return null;
    }

    // 풀 크기보다 적게 가져오기. 풀 작으면 가능한 만큼만.
    const takeCount = Math.min(totalCount, total);

    // 단순 random skip 으로 winner 1개 뽑고, 그 뒤로 candidates 채우기엔 풀 작을 때 같은 곡 중복 가능.
    // → 풀 전체 song id 만 가볍게 가져와서 셔플 후 N개 자르는 게 안전.
    // 큰 풀(수천 곡)에서도 id+title+artist 만 가져오므로 비용 작음. takeCount=20 곡 fetch.
    const allIds = await this.prisma.song.findMany({
      where,
      select: { id: true },
    });
    // Fisher-Yates 부분 셔플 — 앞에서 takeCount 개만 뽑음.
    const ids = allIds.map((s) => s.id);
    for (let i = 0; i < takeCount; i++) {
      const j = i + Math.floor(Math.random() * (ids.length - i));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const pickedIds = ids.slice(0, takeCount);

    const songs = await this.prisma.song.findMany({
      where: { id: { in: pickedIds } },
      select: {
        id: true,
        title: true,
        albumArt: true,
        artist: { select: { name: true } },
      },
    });
    if (songs.length === 0) {
      return null;
    }

    // pickedIds 순서로 정렬 — Fisher-Yates 결과 순서 유지(첫번째 = winner).
    const byId = new Map(songs.map((s) => [s.id, s]));
    const ordered = pickedIds
      .map((id) => byId.get(id))
      .filter((s): s is (typeof songs)[number] => s != null)
      .map((s) => ({
        id: s.id,
        title: s.title,
        artistName: s.artist?.name ?? '',
        albumArt: s.albumArt ?? null,
      }));

    if (ordered.length === 0) {
      return null;
    }

    return {
      winner: ordered[0],
      candidates: ordered,
    };
  }

  /**
   * 후원 재화를 {amount, currencyKey} 쌍으로 정규화합니다.
   *
   * 우선순위:
   * 1. donationNativeAmount + donationCurrency (네이티브 재화)
   * 2. donationAmount (레거시 KRW, KRW_LEGACY로 처리)
   * 3. 후원 없음 → {0, KRW_LEGACY}
   */
  private resolveDonationPair(requestData: {
    donationNativeAmount?: number;
    donationCurrency?: string;
    donationAmount?: number;
  }): { amount: number; currencyKey: string } {
    const { donationNativeAmount, donationCurrency, donationAmount } =
      requestData;

    if (
      donationNativeAmount != null &&
      donationCurrency != null &&
      donationCurrency.trim().length > 0
    ) {
      return { amount: donationNativeAmount, currencyKey: donationCurrency };
    }

    if (donationAmount != null) {
      return { amount: donationAmount, currencyKey: 'KRW_LEGACY' };
    }

    return { amount: 0, currencyKey: 'KRW_LEGACY' };
  }

  /**
   * 후원 금액을 기반으로 우선순위를 계산합니다.
   *
   * 우선순위 규칙:
   * - 0: 일반 신청 (후원 없음)
   * - 1-10: 1,000원 ~ 10,000원
   * - 11-20: 10,001원 ~ 50,000원
   * - 21+: 50,001원 이상
   */
  private calculatePriority(donationAmount: number): number {
    if (donationAmount === 0) {
      return 0;
    }

    if (donationAmount <= 10000) {
      return Math.min(10, Math.floor(donationAmount / 1000));
    }

    if (donationAmount <= 50000) {
      return 10 + Math.min(10, Math.floor((donationAmount - 10000) / 4000));
    }

    return 20 + Math.min(10, Math.floor((donationAmount - 50000) / 10000));
  }

  private normalizeRequiredText(
    value: unknown,
    fieldName: string,
    maxLength: number,
  ): string {
    if (typeof value !== 'string') {
      throw new BadRequestException(`${fieldName}이(가) 올바르지 않습니다.`);
    }

    const trimmed = value.trim();
    if (!trimmed) {
      throw new BadRequestException(`${fieldName}을(를) 입력해주세요.`);
    }

    if (trimmed.length > maxLength) {
      throw new BadRequestException(
        `${fieldName}은(는) ${maxLength}자 이하여야 합니다.`,
      );
    }

    return trimmed;
  }

  private normalizeOptionalText(
    value: unknown,
    maxLength: number,
  ): string | undefined {
    if (value == null) {
      return undefined;
    }

    if (typeof value !== 'string') {
      throw new BadRequestException('신청 메시지가 올바르지 않습니다.');
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    if (trimmed.length > maxLength) {
      throw new BadRequestException(
        `신청 메시지는 ${maxLength}자 이하여야 합니다.`,
      );
    }

    return trimmed;
  }

  /**
   * 대기열에서 신청곡을 제거합니다.
   */
  async removeFromQueue(requestId: number): Promise<void> {
    const request = await this.prisma.songRequest.findUnique({
      where: { id: requestId },
      select: { queueOrder: true, liveSessionId: true },
    });

    if (!request) {
      throw new Error('요청을 찾을 수 없습니다.');
    }

    await this.prisma.$transaction(async (tx) => {
      // 삭제
      await tx.songRequest.delete({
        where: { id: requestId },
      });

      // 뒤에 있는 PENDING/ACCEPTED만 순서 당김. COMPLETED/PLAYING은 setlist
      // 히스토리 용도라 queueOrder를 건드리지 않는다.
      await tx.songRequest.updateMany({
        where: {
          liveSessionId: request.liveSessionId,
          status: {
            in: [SongRequestStatus.PENDING, SongRequestStatus.ACCEPTED],
          },
          queueOrder: {
            gt: request.queueOrder,
          },
        },
        data: {
          queueOrder: {
            decrement: 1,
          },
        },
      });

      // 신청곡 삭제(운영자 삭제 / 본인 취소) → revision bump (GATE 0).
      await enqueuePlaybackRevision(tx, request.liveSessionId, {
        commandType: 'song_request.deleted',
        causationRequestId: requestId,
      });
    });

    // 이벤트 발행: 신청곡 삭제
    this.eventEmitter.emit(SONG_REQUEST_EVENTS.DELETED, {
      requestId,
      liveSessionId: request.liveSessionId,
    });
  }
}
