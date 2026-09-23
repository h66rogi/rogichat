import { Injectable, Inject, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  ResourceNotFoundException,
  InvalidInputException,
} from '../common/exceptions/custom.exception';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import {
  Prisma,
  ChannelTransferStatus,
  ChannelVerificationStatus,
  LiveSessionType,
  StreamPlatform,
} from '@prisma/client';
import {
  emitSongDeletedBatch,
  snapshotSongsForChannelDeletion,
  softDeleteOrphanClipsByIds,
} from '../song/song-cascade-deletion.helper';
import { CHANNEL_EVENTS, ChannelDeletedEvent } from './channel-events';
import {
  channelWithCountsSelect,
  channelWithGlobalProfileSelect,
  type ChannelWithGlobalProfile,
  channelWithUserSelect,
  ChannelWithUserAndCountsOptimized,
} from './prisma/channel.selections';
import { ChannelManagerPermissions } from './types/manager-permissions.type';
import { channelCacheKeys } from './cache/channel.cache-keys';
import { PointsService } from '../points/points.service';
import { PopularChannelQuery } from './queries/popular-channel.query';
import { ChannelSearchQuery } from './queries/channel-search.query';
import { POINT_ACTIONS } from '../points/constants/point-actions';
import { buildPointReason } from '../points/utils/point-reason';
import { CHANNEL_COMMUNITY_DEFAULT_BOARD_SET } from '../community/channel-community/channel-community.constants';
import { ReferralCodeService } from '../referral/referral-code.service';

@Injectable()
export class ChannelService {
  private readonly logger = new Logger(ChannelService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly points: PointsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly referralCodes: ReferralCodeService,
  ) {}

  // 사용자의 Channel 조회
  async findByUserId(userId: number) {
    const channels = await this.prisma.channel.findMany({
      where: { userId: userId },
      select: channelWithCountsSelect,
    });

    return channels;
  }

  async findManagerChannelByUserId(userId: number) {
    const channels = await this.prisma.channel.findMany({
      where: { managers: { some: { userId, isActive: true } } },
      select: channelWithCountsSelect,
    });
    return channels;
  }

  async findChannelManagerByUserId(userId: number) {
    const manager = await this.prisma.channelManager.findMany({
      where: { userId: userId, isActive: true },
      select: {
        channel: {
          select: {
            id: true,
            name: true,
            webPath: true,
            platformUrl: true,
          },
        },
        user: {
          select: {
            id: true,
            nickname: true,
          },
        },
        canManageContent: true,
        canManageSettings: true,
        canManageProfile: true,
        canManageGuestbook: true,
        canManageCustomization: true,
        canManageEmoticons: true,
        canManageHuyeorChat: true,
      },
    });
    return manager;
  }

  // ID로 Channel 조회
  async findById(
    channelId: number,
  ): Promise<ChannelWithUserAndCountsOptimized> {
    // 채널 기본 정보 조회 (빠름)
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId },
      select: channelWithUserSelect,
    });

    if (!channel) {
      throw new ResourceNotFoundException('채널을 찾을 수 없습니다.');
    }

    // 해당 채널의 카운트만 병렬 조회 (channelId 인덱스 사용으로 빠름)
    const counts = await this.getChannelCounts(channel.id);

    return { ...channel, _count: counts };
  }

  // webPath로 Channel 조회 (public API)
  async findByWebPath(
    webPath: string,
  ): Promise<ChannelWithUserAndCountsOptimized> {
    webPath = webPath.toLowerCase();

    // 채널 기본 정보 조회 (빠름 - webPath unique 인덱스 사용)
    const channel = await this.prisma.channel.findFirst({
      where: { webPath: webPath },
      select: channelWithUserSelect,
    });

    if (!channel) {
      throw new ResourceNotFoundException('뮤직북을 찾을 수 없습니다.');
    }

    // 해당 채널의 카운트만 병렬 조회 (channelId 인덱스 사용으로 빠름)
    const counts = await this.getChannelCounts(channel.id);

    return { ...channel, _count: counts };
  }

  // 채널별 카운트 조회 (최적화: 해당 채널 ID에 대해서만 COUNT)
  private async getChannelCounts(
    channelId: number,
  ): Promise<{ songs: number; categories: number; artists: number }> {
    const [songs, categories, artists] = await Promise.all([
      this.prisma.song.count({ where: { channelId } }),
      this.prisma.category.count({ where: { channelId } }),
      this.prisma.artist.count({ where: { channelId } }),
    ]);

    return { songs, categories, artists };
  }

  // identifier로 채널 조회 (ID 또는 webPath 자동 판단)
  // 완전히 숫자로만 구성된 경우 ID로 처리, 그 외는 webPath로 처리
  async findByIdentifier(identifier: string) {
    // 완전히 숫자로만 구성된 경우에만 ID로 처리
    if (/^\d+$/.test(identifier)) {
      return this.findById(parseInt(identifier, 10));
    } else {
      return this.findByWebPath(identifier);
    }
  }

  async resolveChannelIdByIdentifier(
    identifier: string,
  ): Promise<number | null> {
    if (!identifier) {
      return null;
    }

    if (/^\d+$/.test(identifier)) {
      const numericId = parseInt(identifier, 10);
      const byId = await this.prisma.channel.findUnique({
        where: { id: numericId },
        select: { id: true },
      });
      return byId?.id ?? null;
    }

    const byWebPath = await this.prisma.channel.findUnique({
      where: { webPath: identifier },
      select: { id: true },
    });
    return byWebPath?.id ?? null;
  }

  // 채널 검색 (통합 검색: name, web_path, platform_url)
  async searchChannels(
    keyword: string,
    page: number = 1,
    limit: number = 20,
    userId?: number,
  ) {
    const _offset = (page - 1) * limit; // kept for SQL compatibility in query class
    const normalizedKeyword = keyword.toLowerCase();

    // 캐시 키 생성
    const cacheKey = channelCacheKeys.search(normalizedKeyword, page, limit);

    // 캐시 확인
    type ChannelSearchRow = {
      id: number;
      name: string;
      webPath: string;
      platformUrl: string | null;
      topBannerUrl: string | null;
      profileImageUrl: string | null;
      themeColor: string;
      channelDescription: string | null;
      createdAt: Date;
      updatedAt: Date;
      relevanceScore: number;
      isVerified: boolean;
    };
    type ChannelSearchCached = {
      channels: (ChannelSearchRow & {
        user?: {
          id: number;
          nickname: string;
          profileImageUrl: string | null;
        } | null;
        isFavorite?: boolean;
      })[];
      pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
      };
    };
    const cacheValue = await this.cacheManager.get(cacheKey);
    const cached: ChannelSearchCached | undefined =
      (cacheValue as ChannelSearchCached) ?? undefined;

    if (cached && !userId) {
      return cached;
    }

    const searchQuery = new ChannelSearchQuery(this.prisma);
    const { rows: channels, total } = await searchQuery.search({
      keyword,
      page,
      limit,
    });

    // 사용자 정보 추가 조회 (구독 정보 포함)
    const channelIds = channels.map((channel) => channel.id);
    const users = await this.prisma.user.findMany({
      where: {
        channels: {
          some: {
            id: { in: channelIds },
          },
        },
      },
      select: {
        id: true,
        nickname: true,
        profileImageUrl: true,
        isProSubscriber: true,
        proSubscriptionEndAt: true,
        isAmbassador: true,
        channels: {
          select: { id: true },
          where: { id: { in: channelIds } },
        },
      },
    });

    // 채널에 사용자 정보 매핑
    const channelsWithUsers = channels.map((channel) => {
      const user = users.find((u) =>
        u.channels.some((c) => c.id === channel.id),
      );
      return {
        id: channel.id,
        name: channel.name,
        webPath: channel.webPath,
        platformUrl: channel.platformUrl,
        topBannerUrl: channel.topBannerUrl,
        profileImageUrl: channel.profileImageUrl,
        themeColor: channel.themeColor,
        channelDescription: channel.channelDescription,
        createdAt: channel.createdAt,
        updatedAt: channel.updatedAt,
        relevanceScore: Number(channel.relevanceScore),
        isVerified: !!channel.isVerified,
        user: user
          ? {
              id: user.id,
              nickname: user.nickname,
              profileImageUrl: user.profileImageUrl,
              isProSubscriber: user.isProSubscriber,
              proSubscriptionEndAt: user.proSubscriptionEndAt,
              isAmbassador: user.isAmbassador,
            }
          : null,
        isFavorite: false,
      };
    });

    const result = {
      channels: channelsWithUsers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };

    // 캐시에 저장 (30초 TTL) - BigInt 안전 직렬화 처리
    type JsonPrimitive = string | number | boolean | null;
    type Json = JsonPrimitive | Json[] | { [key: string]: Json };
    const toCacheSafe = (value: unknown): Json => {
      if (value === null || value === undefined) return null;
      if (typeof value === 'bigint') return Number(value);
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      )
        return value;
      if (value instanceof Date) return value.toISOString();
      if (Array.isArray(value))
        return (value as unknown[]).map((v) => toCacheSafe(v));
      if (typeof value === 'object') {
        const out: { [key: string]: Json } = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          out[k] = toCacheSafe(v);
        }
        return out;
      }
      return null;
    };

    await this.cacheManager.set(cacheKey, toCacheSafe(result), 30 * 1000);

    // 사용자별 isFavorite 오버레이 (캐시에 저장하지 않음)
    if (userId) {
      const channelIds = channelsWithUsers.map((c) => c.id);
      if (channelIds.length > 0) {
        const favorites = await this.prisma.userChannelFavorite.findMany({
          where: { userId, channelId: { in: channelIds } },
          select: { channelId: true },
        });
        const favSet = new Set(favorites.map((f) => f.channelId));
        return {
          ...result,
          channels: channelsWithUsers.map((c) => ({
            ...c,
            isFavorite: favSet.has(c.id),
          })),
        };
      }
    }

    return result;
  }

  // Channel 업데이트
  async update(
    channelId: number,
    userId: number,
    updateData: Prisma.ChannelUpdateInput,
  ) {
    // 권한 확인: 소유자 또는 settings 매니저
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId },
    });
    if (!channel) {
      throw new ResourceNotFoundException('채널을 찾을 수 없습니다.');
    }
    if (channel.userId !== userId) {
      const manager = await this.prisma.channelManager.findUnique({
        where: { channelId_userId: { channelId, userId } },
        select: { isActive: true, canManageSettings: true },
      });
      if (!manager?.isActive || !manager.canManageSettings) {
        throw new UnauthorizedException('뮤직북을 수정할 권한이 없습니다.');
      }
    }

    // platformUrl은 채널 인증을 통해서만 변경 가능하므로 업데이트에서 제외
    // (채널 인증 시 ChannelVerificationService에서 직접 업데이트함)
    delete updateData.platformUrl;

    if (updateData.webPath && typeof updateData.webPath === 'string') {
      const normalizedWebPath = updateData.webPath.toLowerCase();
      const existingChannel = await this.prisma.channel.findFirst({
        where: {
          webPath: normalizedWebPath,
          id: { not: channelId },
        },
      });
      if (existingChannel) {
        throw new InvalidInputException('이미 사용 중인 채널 주소입니다.');
      }
      updateData.webPath = normalizedWebPath;
    }

    const updatedChannel = await this.prisma.channel.update({
      where: { id: channelId },
      data: updateData,
      select: channelWithCountsSelect,
    });

    // Clear related caches
    await this.cacheManager.del(channelCacheKeys.byId(channelId));
    await this.cacheManager.del(
      channelCacheKeys.byWebPath(updatedChannel.webPath),
    );
    await this.cacheManager.del(channelCacheKeys.publicStats());

    return updatedChannel;
  }

  // 사용자의 기본 Channel 조회 (첫 번째 Channel)
  async findPrimaryByUserId(
    userId: number,
  ): Promise<ChannelWithUserAndCountsOptimized> {
    const channel = await this.prisma.channel.findFirst({
      where: { userId: userId },
      orderBy: { createdAt: 'asc' },
      select: channelWithUserSelect,
    });

    if (!channel) {
      throw new ResourceNotFoundException('뮤직북을 찾을 수 없습니다.');
    }

    const counts = await this.getChannelCounts(channel.id);

    return { ...channel, _count: counts };
  }

  // Channel 통계 조회
  async getStats(channelId: number) {
    const stats = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: {
        _count: {
          select: {
            songs: true,
            categories: true,
            artists: true,
          },
        },
      },
    });

    return stats?._count || { songs: 0, categories: 0, artists: 0 };
  }

  // JWT user.id에서 기본 Channel ID 조회 (API 호환성용)
  async getChannelIdByUserId(userId: number): Promise<number> {
    const channel = await this.findPrimaryByUserId(userId);
    return channel.id;
  }

  // Channel 소유권 확인
  async validateChannelOwnership(
    channelId: number,
    userId: number,
  ): Promise<boolean> {
    const channel = await this.prisma.channel.findFirst({
      where: {
        id: channelId,
        userId: userId,
      },
    });

    return !!channel;
  }

  // 채널 매니저 권한 조회 (가드용)
  async getManagerPermissions(
    channelId: number,
    userId: number,
  ): Promise<ChannelManagerPermissions> {
    return this.prisma.channelManager.findUnique({
      where: { channelId_userId: { channelId, userId } },
      select: {
        isActive: true,
        canManageContent: true,
        canManageSettings: true,
        canManageProfile: true,
        canManageGuestbook: true,
        canManageCustomization: true,
        canManageEmoticons: true,
        canManageHuyeorChat: true,
      },
    });
  }

  /**
   * 특정 채널에 대한 content 권한 확인 (소유자 또는 canManageContent 매니저)
   * 플레이리스트/클립 등 content 작성 권한 체크에 재사용
   */
  async hasChannelContentPermission(
    userId: number,
    channelId: number,
  ): Promise<boolean> {
    const isOwner = await this.validateChannelOwnership(channelId, userId);
    if (isOwner) return true;

    const manager = await this.getManagerPermissions(channelId, userId);
    if (manager?.isActive && manager.canManageContent) {
      return true;
    }

    return false;
  }

  // Channel 생성
  async create(userId: number, createData: Prisma.ChannelCreateInput) {
    return this.createWithOptions(userId, createData, {
      enforceSingleChannelLimit: true,
    });
  }

  async createSystemProvisioned(
    userId: number,
    createData: Prisma.ChannelCreateInput,
  ) {
    return this.createWithOptions(userId, createData, {
      enforceSingleChannelLimit: false,
    });
  }

  private async createWithOptions(
    userId: number,
    createData: Prisma.ChannelCreateInput,
    options: { enforceSingleChannelLimit: boolean },
  ) {
    if (createData.webPath && typeof createData.webPath === 'string') {
      const normalizedWebPath = createData.webPath.toLowerCase();
      const existingChannel = await this.prisma.channel.findFirst({
        where: { webPath: normalizedWebPath },
      });
      if (existingChannel) {
        throw new InvalidInputException('이미 사용 중인 채널 주소입니다.');
      }
      createData.webPath = normalizedWebPath;
    }

    // platformUrl 중복 확인
    if (createData.platformUrl && typeof createData.platformUrl === 'string') {
      const existingChannel = await this.prisma.channel.findFirst({
        where: { platformUrl: createData.platformUrl },
      });
      if (existingChannel) {
        throw new InvalidInputException(
          '이미 사용 중인 방송 플랫폼 주소입니다.',
        );
      }
    }

    if (options.enforceSingleChannelLimit) {
      // 사용자의 Channel 보유 개수 확인 (최대 1개까지 허용)
      const userChannelCount = await this.prisma.channel.count({
        where: { userId },
      });
      if (userChannelCount >= 1) {
        throw new InvalidInputException(
          '사용자는 최대 1개의 채널만 생성할 수 있습니다.',
        );
      }
    }

    const pendingIncomingTransfer =
      await this.prisma.channelTransferRequest.findFirst({
        where: {
          targetUserId: userId,
          status: ChannelTransferStatus.PENDING,
        },
        select: { id: true },
      });
    if (pendingIncomingTransfer) {
      throw new InvalidInputException(
        '현재 수락 대기 중인 채널 이전 요청이 있습니다. 먼저 요청을 처리해주세요.',
      );
    }

    // Channel과 소유자의 추천 코드는 같은 트랜잭션에서 함께 보장한다.
    const newChannel = await this.prisma.$transaction(async (tx) => {
      await this.referralCodes.ensureForUser(userId, tx);
      return tx.channel.create({
        data: createData,
        select: channelWithCountsSelect,
      });
    });

    await this.ensureDefaultCommunityBoards(newChannel.id, newChannel.name);

    // 포인트 지급: CHANNEL_CREATE 2000P (멱등)
    try {
      await this.points.grant({
        userId,
        amount: 2000,
        action: POINT_ACTIONS.CHANNEL_CREATE,
        uniqueKey: `channel:create:${newChannel.id}`,
        reason: buildPointReason(POINT_ACTIONS.CHANNEL_CREATE, {
          channelName: newChannel.name,
        }),
        referenceType: 'channel',
        referenceId: String(newChannel.id),
      });
    } catch (e) {
      this.logger.error(
        `POINTS_GRANT_FAILED action=CHANNEL_CREATE channelId=${newChannel.id} userId=${userId}`,
        e instanceof Error ? e.stack : undefined,
      );
    }

    // 캐시 무효화
    await this.cacheManager.del(channelCacheKeys.byUser(userId));

    return newChannel;
  }

  private async ensureDefaultCommunityBoards(
    channelId: number,
    channelName: string,
  ): Promise<void> {
    const group =
      (await this.prisma.communityBoardGroup.findFirst({
        where: { channelId },
        select: { id: true },
      })) ??
      (await this.prisma.communityBoardGroup.create({
        data: {
          channelId,
          name: `${channelName} 게시판`,
          description: '채널 기본 게시판',
          isActive: true,
        },
        select: { id: true },
      }));

    for (const item of CHANNEL_COMMUNITY_DEFAULT_BOARD_SET) {
      const existing = await this.prisma.communityBoard.findFirst({
        where: {
          channelId,
          channelBoardKey: item.key,
        },
        select: { id: true },
      });
      if (existing) continue;

      await this.prisma.$transaction(async (tx) => {
        const board = await tx.communityBoard.create({
          data: {
            boardGroupId: group.id,
            channelId,
            channelBoardKey: item.key,
            slug: `channel-${channelId}-${item.key}`,
            name: item.name,
            description: item.description,
            displayOrder: item.displayOrder,
            readPermission: item.readPermission,
            writePermission: item.writePermission,
            commentPermission: item.commentPermission,
            allowReplies: item.allowReplies,
            allowReactions: item.allowReactions,
            isActive: true,
          },
          select: { id: true },
        });

        await tx.communityCategory.create({
          data: {
            boardId: board.id,
            name: item.categoryName,
            displayOrder: 0,
            isActive: true,
          },
        });
      });
    }
  }

  // Channel 삭제
  async delete(
    channelId: number,
    userId: number,
    options?: { actorIsAdmin?: boolean },
  ) {
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId },
    });
    if (!channel) {
      throw new ResourceNotFoundException('채널을 찾을 수 없습니다.');
    }
    const actorIsAdmin = Boolean(options?.actorIsAdmin);
    if (channel.userId !== userId && !actorIsAdmin) {
      throw new UnauthorizedException('뮤직북을 삭제할 권한이 없습니다.');
    }

    // Snapshot all songs that will be cascade-deleted, then delete the channel
    // and reverse the channel-creation reward inside one transaction. This is
    // deliberately all-or-nothing: a future FK restriction must never leave
    // the channel alive after its 2,000P reward has already been reclaimed.
    // The channel row is locked FOR UPDATE so a concurrent song insert cannot
    // land between snapshot and delete; that insert would otherwise be
    // cascade-deleted without a SONG_DELETED event, leaving the GlobalSong
    // index drifted (the original CS bug).
    //
    // song_categories cascades with the song row, so the snapshot has to run
    // before the delete. SONG_DELETED is emitted only AFTER the transaction
    // commits — emitting earlier and then failing the delete would deindex
    // songs that still exist.
    let songEvents: Awaited<
      ReturnType<typeof snapshotSongsForChannelDeletion>
    >;
    try {
      songEvents = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM channels WHERE id = ${channelId} FOR UPDATE`;

        const createdTx = await tx.pointTransaction.findFirst({
          where: {
            userId: channel.userId,
            uniqueKey: `channel:create:${channelId}`,
          },
          select: { id: true },
        });
        if (createdTx) {
          await this.points.reverseWithTx(
            tx,
            channel.userId,
            String(createdTx.id),
            { allowNegative: true },
          );
        }

        const events = await snapshotSongsForChannelDeletion(tx, channelId);
        // Soft-delete clips that become orphans (every clipChannel referenced
        // only the channel's songs). ClipChannel.song cascade-deletes with the
        // song row, so the post-cascade clip would be left in VISIBLE status
        // with zero clipChannels.
        const songIds = events.map((e) => e.songId);
        await softDeleteOrphanClipsByIds(tx, songIds, channelId);
        await tx.channel.delete({ where: { id: channelId } });
        return events;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        this.logger.error(
          `CHANNEL_DELETE_FK_BLOCKED channelId=${channelId} field=${String(error.meta?.field_name ?? 'unknown')}`,
        );
        throw new ConflictException(
          '연결된 데이터를 안전하게 정리하지 못해 채널을 삭제할 수 없습니다. 잠시 후 다시 시도해 주세요.',
        );
      }
      throw error;
    }

    emitSongDeletedBatch(this.eventEmitter, songEvents);

    const channelDeletedEvent: ChannelDeletedEvent = {
      channelId,
      webPath: channel.webPath ?? null,
    };
    this.eventEmitter.emit(CHANNEL_EVENTS.CHANNEL_DELETED, channelDeletedEvent);

    await this.cacheManager.del(channelCacheKeys.byUser(channel.userId));
    if (channel.webPath) {
      await this.cacheManager.del(channelCacheKeys.byWebPath(channel.webPath));
    }

    return { message: '뮤직북이 성공적으로 삭제되었습니다.' };
  }

  // 인기 스트리머 목록 (노래 수 기준 상위 50명 중 랜덤 샘플)
  async listFamousChannels(
    limit: number,
    options?: {
      days?: number;
      weights?: { fav: number; like: number; song: number };
    },
  ): Promise<import('./prisma/channel.selections').ChannelWithCounts[]> {
    // 1시간 TTL 캐시 키
    const weights = options?.weights ?? { fav: 1.5, like: 1.0, song: 0.1 };
    const since = options?.days
      ? new Date(Date.now() - options.days * 24 * 60 * 60 * 1000)
      : null;
    const cacheKey = channelCacheKeys.popular({
      since: since ? since.toISOString().slice(0, 10) : null,
      wF: weights.fav,
      wL: weights.like,
      wS: weights.song,
      limit: Math.max(1, limit),
    });

    const cached =
      await this.cacheManager.get<
        import('./prisma/channel.selections').ChannelWithCounts[]
      >(cacheKey);
    if (cached) {
      return cached;
    }

    const query = new PopularChannelQuery(this.prisma);
    const rows = await query.findPopularChannelIds({
      limit: Math.max(1, Math.min(50, limit)),
      weights,
      since,
      minSongs: 10,
    });

    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return [];

    // 상세 정보 select (user 구독 정보 포함)
    const entities = await this.prisma.channel.findMany({
      where: { id: { in: ids } },
      select: {
        ...channelWithCountsSelect,
        user: {
          select: {
            isProSubscriber: true,
            proSubscriptionEndAt: true,
            isAmbassador: true,
          },
        },
      },
    });
    // 원래 순서 유지
    const order = new Map(ids.map((id, idx) => [id, idx]));
    const ordered = entities.sort((a, b) => {
      return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
    });

    // 쿼리에서 계산된 메트릭 병합
    const metrics = new Map<
      number,
      {
        favoritesCount: number;
        songLikesCount: number;
        songsCount: number;
        popularityScore: number;
      }
    >(
      rows.map((r) => [
        r.id,
        {
          favoritesCount: r.favoritesCount,
          songLikesCount: r.songLikesCount,
          songsCount: r.songsCount,
          popularityScore: r.popularityScore,
        },
      ]),
    );

    const enriched = ordered.map((e) => {
      const m = metrics.get(e.id);
      return m ? { ...e, ...m } : e;
    });

    // BigInt 안전 직렬화 처리
    type JsonPrimitive = string | number | boolean | null;
    type Json = JsonPrimitive | Json[] | { [key: string]: Json };
    const toCacheSafe = (value: unknown): Json => {
      if (value === null || value === undefined) return null;
      if (typeof value === 'bigint') return Number(value);
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      )
        return value;
      if (value instanceof Date) return value.toISOString();
      if (Array.isArray(value))
        return (value as unknown[]).map((v) => toCacheSafe(v));
      if (typeof value === 'object') {
        const out: { [key: string]: Json } = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          out[k] = toCacheSafe(v);
        }
        return out;
      }
      return null;
    };

    await this.cacheManager.set(
      cacheKey,
      toCacheSafe(enriched),
      60 * 60 * 1000,
    );
    return enriched as unknown as import('./prisma/channel.selections').ChannelWithCounts[];
  }

  // 최근 가입 스트리머 (노래 1개 이상 보유, 생성일 기준 내림차순)
  async listRecentChannels(limit: number) {
    const size = Math.max(1, limit);
    return this.prisma.channel.findMany({
      where: { songs: { some: {} }, visibility: 'PUBLIC' },
      select: {
        ...channelWithCountsSelect,
        user: {
          select: {
            isProSubscriber: true,
            proSubscriptionEndAt: true,
            isAmbassador: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: size,
    });
  }

  // ===================================================================
  // meloming.gg (글로벌 mirror) 전용 조회
  // ===================================================================

  /**
   * 글로벌 인기 채널 (popularity 기반 상위 N 풀에서 random sample).
   * - 내부적으로 listFamousChannels(poolSize) 호출 → globalProfile opt-out 필터 → Fisher-Yates shuffle → take(limit).
   * - opt-out 정책: globalProfile null OR globalEnabled=true 인 채널만 통과.
   * - 매 요청마다 다른 순서로 노출되어 카탈로그가 fresh 하게 보임.
   */
  async listGlobalPopularChannels(
    limit: number,
    poolSize = 100,
  ): Promise<ChannelWithGlobalProfile[]> {
    const take = Math.max(1, Math.min(50, limit));
    const pool = Math.max(take, Math.min(200, poolSize));

    // 인기 채널 풀 (popularity 가중치 기반, 1시간 캐시).
    const famousIds = (await this.listFamousChannels(pool)).map((c) => c.id);
    if (famousIds.length === 0) return [];

    // opt-out 필터링 + 글로벌 select 로 재조회.
    const eligible = await this.prisma.channel.findMany({
      where: {
        id: { in: famousIds },
        visibility: 'PUBLIC',
        OR: [
          { globalProfile: { is: null } },
          { globalProfile: { is: { globalEnabled: true } } },
        ],
      },
      select: channelWithGlobalProfileSelect,
    });

    // Fisher-Yates shuffle
    const arr = [...eligible];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.slice(0, take);
  }

  /**
   * 글로벌 신규 등록 채널 (createdAt desc + opt-out 필터).
   */
  async listGlobalRecentChannels(
    limit: number,
  ): Promise<ChannelWithGlobalProfile[]> {
    const take = Math.max(1, Math.min(50, limit));
    return this.prisma.channel.findMany({
      where: {
        visibility: 'PUBLIC',
        songs: { some: {} },
        OR: [
          { globalProfile: { is: null } },
          { globalProfile: { is: { globalEnabled: true } } },
        ],
      },
      select: channelWithGlobalProfileSelect,
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  /**
   * 글로벌 노출 채널 리스트 (opt-out 모델).
   * - globalProfile row 없음 (default true) OR globalEnabled=true 인 모든 PUBLIC 채널 노출.
   * - locale 필터는 row 가 있고 primaryLocale 매칭하는 경우에만 (row 없는 채널은 locale 필터 시 미포함).
   * - 정렬: 등록 노래 수 desc → name asc. (Phase 1 단순 정렬)
   */
  async listGlobalChannels(
    limit: number,
    locale?: string,
  ): Promise<ChannelWithGlobalProfile[]> {
    const size = Math.max(1, Math.min(50, limit));
    const where: Prisma.ChannelWhereInput = locale
      ? {
          visibility: 'PUBLIC',
          globalProfile: { is: { globalEnabled: true, primaryLocale: locale } },
        }
      : {
          visibility: 'PUBLIC',
          OR: [
            { globalProfile: { is: null } },
            { globalProfile: { is: { globalEnabled: true } } },
          ],
        };
    return this.prisma.channel.findMany({
      where,
      select: channelWithGlobalProfileSelect,
      orderBy: [{ songs: { _count: 'desc' } }, { name: 'asc' }],
      take: size,
    });
  }

  /**
   * 글로벌 채널 검색 (opt-out 모델).
   * - 노출 조건: globalProfile null OR globalEnabled=true.
   * - 매칭: keyword 가 channel.name / channel.webPath / globalProfile.globalName 중 하나에 contains.
   */
  async searchGlobalChannels(
    keyword: string,
    page: number,
    limit: number,
  ): Promise<{
    channels: ChannelWithGlobalProfile[];
    pagination: { page: number; limit: number; total: number };
  }> {
    const trimmed = keyword.trim();
    const take = Math.max(1, Math.min(50, limit));
    const skip = (Math.max(1, page) - 1) * take;

    if (!trimmed) {
      return {
        channels: [],
        pagination: { page, limit: take, total: 0 },
      };
    }

    const where: Prisma.ChannelWhereInput = {
      visibility: 'PUBLIC',
      AND: [
        {
          OR: [
            { globalProfile: { is: null } },
            { globalProfile: { is: { globalEnabled: true } } },
          ],
        },
        {
          OR: [
            { name: { contains: trimmed } },
            { webPath: { contains: trimmed } },
            { globalProfile: { is: { globalName: { contains: trimmed } } } },
          ],
        },
      ],
    };

    const [channels, total] = await Promise.all([
      this.prisma.channel.findMany({
        where,
        select: channelWithGlobalProfileSelect,
        orderBy: [{ songs: { _count: 'desc' } }, { name: 'asc' }],
        skip,
        take,
      }),
      this.prisma.channel.count({ where }),
    ]);

    return {
      channels,
      pagination: { page: Math.max(1, page), limit: take, total },
    };
  }

  // 노래 1개 이상 보유한 모든 채널 조회 (출력 제한 없음)
  async listAllChannelsWithSongs() {
    return this.prisma.channel.findMany({
      where: { songs: { some: {} }, visibility: 'PUBLIC' },
      select: {
        ...channelWithCountsSelect,
        user: {
          select: {
            isProSubscriber: true,
            proSubscriptionEndAt: true,
            isAmbassador: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  // ===================================================================
  // 외부 서비스(meloming-ranking 등) 연동용 public 조회 메서드
  // ===================================================================

  /**
   * (platform, platformChannelId) → APPROVED ChannelVerification → channelId
   * 매핑된 channelId를 반환. 매칭되는 인증이 없으면 null.
   *
   * 동일한 (platform, platformChannelId)에 대해 여러 APPROVED 레코드가
   * 존재할 일은 거의 없지만, 방어적으로 가장 최근(createdAt DESC) 레코드를 사용.
   */
  async findChannelIdByPlatform(
    platform: StreamPlatform,
    platformChannelId: string,
  ): Promise<number | null> {
    // 1차: ChannelVerification (채널 인증 시스템)
    const verification = await this.prisma.channelVerification.findFirst({
      where: {
        platform,
        platformChannelId,
        status: ChannelVerificationStatus.APPROVED,
      },
      select: { channelId: true },
      orderBy: { createdAt: 'desc' },
    });

    if (verification) return verification.channelId;

    // 2차: Channel.platformUrl 역매칭 (인증 시스템 도입 전 채널)
    const platformUrlPatterns = this.buildPlatformUrlPatterns(
      platform,
      platformChannelId,
    );
    if (platformUrlPatterns.length === 0) return null;

    const channel = await this.prisma.channel.findFirst({
      where: { platformUrl: { in: platformUrlPatterns } },
      select: { id: true },
    });

    return channel?.id ?? null;
  }

  /**
   * 플랫폼별 URL 패턴 생성 (platformUrl 역매칭용).
   * 각 플랫폼에서 사용 가능한 URL 형태를 모두 반환한다.
   */
  private buildPlatformUrlPatterns(
    platform: StreamPlatform,
    channelId: string,
  ): string[] {
    switch (platform) {
      case 'CHZZK':
        return [
          `https://chzzk.naver.com/${channelId}`,
          `https://chzzk.naver.com/live/${channelId}`,
        ];
      case 'SOOP':
        return [
          `https://play.sooplive.com/${channelId}`,
          `https://bj.sooplive.co.kr/${channelId}`,
          `https://play.afreecatv.com/${channelId}`,
          `https://bj.afreecatv.com/${channelId}`,
        ];
      case 'CIME':
        return [`https://ci.me/@${channelId}`];
      default:
        return [];
    }
  }

  /**
   * (platform, platformChannelId)로 채널 기본 정보 조회.
   * 외부 서비스(meloming-ranking)에서 호출하므로 PII는 포함하지 않는다.
   */
  async getByPlatform(
    platform: StreamPlatform,
    platformChannelId: string,
  ): Promise<{
    channelId: number;
    name: string;
    webPath: string;
    profileImageUrl: string | null;
    themeColor: string | null;
    platformUrl: string | null;
  }> {
    const channelId = await this.findChannelIdByPlatform(
      platform,
      platformChannelId,
    );

    if (channelId === null) {
      throw new ResourceNotFoundException(
        '해당 플랫폼 채널과 연결된 멜로밍 채널을 찾을 수 없습니다.',
      );
    }

    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: {
        id: true,
        name: true,
        webPath: true,
        profileImageUrl: true,
        themeColor: true,
        platformUrl: true,
      },
    });

    if (!channel) {
      throw new ResourceNotFoundException('채널을 찾을 수 없습니다.');
    }

    return {
      channelId: channel.id,
      name: channel.name,
      webPath: channel.webPath,
      profileImageUrl: channel.profileImageUrl ?? null,
      themeColor: channel.themeColor ?? null,
      platformUrl: channel.platformUrl ?? null,
    };
  }

  /**
   * (platform, platformChannelId)로 방송 히스토리 조회.
   */
  async getBroadcastHistory(
    platform: StreamPlatform,
    platformChannelId: string,
    days: number = 30,
    limit: number = 20,
  ): Promise<{
    channelId: number;
    items: Array<{
      id: number;
      platform: string;
      startedAt: string;
      endedAt: string | null;
      status: string;
      durationMinutes: number | null;
    }>;
    total: number;
    days: number;
    limit: number;
  }> {
    const channelId = await this.findChannelIdByPlatform(
      platform,
      platformChannelId,
    );
    if (channelId === null) {
      throw new ResourceNotFoundException(
        '해당 플랫폼 채널과 연결된 멜로밍 채널을 찾을 수 없습니다.',
      );
    }

    const since = new Date();
    since.setDate(since.getDate() - days);

    const [sessions, count] = await Promise.all([
      this.prisma.liveSession.findMany({
        where: {
          channelId,
          sessionType: LiveSessionType.STANDARD,
          startedAt: { gte: since },
          sourcePerformanceId: null,
        },
        select: {
          id: true,
          platform: true,
          startedAt: true,
          endedAt: true,
          status: true,
        },
        orderBy: { startedAt: 'desc' },
        take: limit,
      }),
      this.prisma.liveSession.count({
        where: {
          channelId,
          sessionType: LiveSessionType.STANDARD,
          startedAt: { gte: since },
          sourcePerformanceId: null,
        },
      }),
    ]);

    return {
      channelId,
      items: sessions.map((s) => ({
        id: s.id,
        platform: s.platform ?? 'UNKNOWN',
        startedAt: s.startedAt.toISOString(),
        endedAt: s.endedAt?.toISOString() ?? null,
        status: s.status,
        durationMinutes: s.endedAt
          ? Math.round((s.endedAt.getTime() - s.startedAt.getTime()) / 60000)
          : null,
      })),
      total: count,
      days,
      limit,
    };
  }

  // 헬퍼: 외부에서 전달된 platform 문자열을 StreamPlatform enum으로 변환.
  // ranking 연동에서는 OTHER는 의미가 없으므로 chzzk/soop/cime 만 허용한다.
  static parseStreamPlatformOrThrow(value: string): StreamPlatform {
    const normalized = (value ?? '').toLowerCase();
    const allowed: Record<string, StreamPlatform> = {
      chzzk: StreamPlatform.CHZZK,
      soop: StreamPlatform.SOOP,
      cime: StreamPlatform.CIME,
    };
    const platform = allowed[normalized];
    if (!platform) {
      throw new InvalidInputException(
        `지원하지 않는 platform 값입니다: ${value} (chzzk, soop, cime 만 허용)`,
      );
    }
    return platform;
  }

  /**
   * (platform, platformChannelId[]) 목록을 받아 멜로밍 회원 여부를 batch 조회.
   * - 회원이면 isMember: true + userId, channelId, channelName, webPath
   * - 비회원이면 isMember: false
   */
  async getMembershipByPlatformIds(
    platform: StreamPlatform,
    platformChannelIds: string[],
  ): Promise<
    Record<
      string,
      | {
          isMember: true;
          userId: number;
          channelId: number;
          channelName: string;
          webPath: string;
        }
      | { isMember: false }
    >
  > {
    const results: Record<
      string,
      | {
          isMember: true;
          userId: number;
          channelId: number;
          channelName: string;
          webPath: string;
        }
      | { isMember: false }
    > = {};

    // 모든 channelId를 기본적으로 비회원으로 초기화
    for (const id of platformChannelIds) {
      results[id] = { isMember: false };
    }

    // 각 channelId에 대해 findChannelIdByPlatform 호출
    const channelLookups = await Promise.all(
      platformChannelIds.map(async (platformChannelId) => {
        const melomingChannelId = await this.findChannelIdByPlatform(
          platform,
          platformChannelId,
        );
        return { platformChannelId, melomingChannelId };
      }),
    );

    // 매핑된 채널이 있는 것만 DB에서 userId/name/webPath 조회
    const mappedIds = channelLookups
      .filter((l) => l.melomingChannelId !== null)
      .map((l) => ({
        platformChannelId: l.platformChannelId,
        melomingChannelId: l.melomingChannelId,
      }));

    if (mappedIds.length === 0) return results;

    const channels = await this.prisma.channel.findMany({
      where: { id: { in: mappedIds.map((m) => m.melomingChannelId) } },
      select: { id: true, userId: true, name: true, webPath: true },
    });

    const channelMap = new Map(channels.map((c) => [c.id, c]));

    for (const { platformChannelId, melomingChannelId } of mappedIds) {
      const channel = channelMap.get(melomingChannelId);
      if (channel) {
        results[platformChannelId] = {
          isMember: true,
          userId: channel.userId,
          channelId: channel.id,
          channelName: channel.name,
          webPath: channel.webPath,
        };
      }
    }

    return results;
  }

  /**
   * 내부 서비스용 batch lookup.
   * 회원 매칭 + 마케팅 수신 동의 + userType 까지 한 번에 반환한다.
   *
   * 응답에 PII(email, phone)는 포함하지 않는다. 이메일 발송이 필요하면
   * 별도 internal endpoint 에서 consent 재확인 후 전달한다.
   */
  async getMembershipWithUserMetaByPlatformIds(
    platform: StreamPlatform,
    platformChannelIds: string[],
  ): Promise<
    Record<
      string,
      | {
          isMember: true;
          userId: number;
          channelId: number;
          channelName: string;
          webPath: string;
          marketingConsent: boolean;
          userType: string | null;
        }
      | { isMember: false }
    >
  > {
    const results: Record<
      string,
      | {
          isMember: true;
          userId: number;
          channelId: number;
          channelName: string;
          webPath: string;
          marketingConsent: boolean;
          userType: string | null;
        }
      | { isMember: false }
    > = {};

    for (const id of platformChannelIds) {
      results[id] = { isMember: false };
    }

    const channelLookups = await Promise.all(
      platformChannelIds.map(async (platformChannelId) => {
        const melomingChannelId = await this.findChannelIdByPlatform(
          platform,
          platformChannelId,
        );
        return { platformChannelId, melomingChannelId };
      }),
    );

    const mappedIds = channelLookups
      .filter(
        (l): l is { platformChannelId: string; melomingChannelId: number } =>
          l.melomingChannelId !== null,
      )
      .map((l) => ({
        platformChannelId: l.platformChannelId,
        melomingChannelId: l.melomingChannelId,
      }));

    if (mappedIds.length === 0) return results;

    const channels = await this.prisma.channel.findMany({
      where: { id: { in: mappedIds.map((m) => m.melomingChannelId) } },
      select: {
        id: true,
        userId: true,
        name: true,
        webPath: true,
        user: {
          select: {
            marketingConsent: true,
            userType: true,
          },
        },
      },
    });

    const channelMap = new Map(channels.map((c) => [c.id, c]));

    for (const { platformChannelId, melomingChannelId } of mappedIds) {
      const channel = channelMap.get(melomingChannelId);
      if (channel) {
        results[platformChannelId] = {
          isMember: true,
          userId: channel.userId,
          channelId: channel.id,
          channelName: channel.name,
          webPath: channel.webPath,
          marketingConsent: channel.user?.marketingConsent === true,
          userType: channel.user?.userType ?? null,
        };
      }
    }

    return results;
  }
}
