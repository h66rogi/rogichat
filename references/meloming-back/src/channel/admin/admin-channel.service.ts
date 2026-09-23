import { Injectable } from '@nestjs/common';
import {
  ChannelVerificationStatus,
  LiveSessionStatus,
  LiveSessionType,
  Prisma,
} from '@prisma/client';
import { ResourceNotFoundException } from '../../common/exceptions/custom.exception';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AdminChannelListQueryDto,
  AdminChannelSortBy,
  AdminChannelSortOrder,
} from './dto/admin-channel.request.dto';
import {
  AdminChannelDetailDto,
  AdminChannelListItemDto,
  AdminChannelListResponseDto,
} from './dto/admin-channel.response.dto';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const channelListSelect = {
  id: true,
  userId: true,
  name: true,
  webPath: true,
  platformUrl: true,
  profileImageUrl: true,
  themeColor: true,
  visibility: true,
  channelDescription: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      id: true,
      email: true,
      nickname: true,
      profileImageUrl: true,
      isActive: true,
      isDeleted: true,
      isProSubscriber: true,
      proSubscriptionEndAt: true,
      isAmbassador: true,
    },
  },
  verifications: {
    where: { status: { not: ChannelVerificationStatus.REVOKED } },
    select: {
      id: true,
      platform: true,
      platformChannelId: true,
      status: true,
      pendingReason: true,
      createdAt: true,
      reviewedAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 4,
  },
  globalProfile: {
    select: {
      globalEnabled: true,
      globalName: true,
      globalDescription: true,
      globalProfileImageUrl: true,
      primaryLocale: true,
    },
  },
  customization: {
    select: {
      isEnabled: true,
      forcedColorMode: true,
      layoutWidth: true,
      headerStyle: true,
    },
  },
  songRequestSettings: {
    select: {
      requestCommand: true,
      maxQueueSize: true,
      donationPriorityEnabled: true,
      enforceDonationMinimumPrice: true,
      karaokePlaybackMode: true,
      karaokeVideoType: true,
      donationOnlyEnabled: true,
      requestMode: true,
      chatRequestEnabled: true,
      donationRequestEnabled: true,
      allowAnonymous: true,
      requireSongMatch: true,
      randomRequestEnabled: true,
      preventDuplicateSongs: true,
      maxRequestsPerUser: true,
      maxTotalRequests: true,
      showRequesterName: true,
      updatedAt: true,
    },
  },
  liveSessions: {
    select: {
      id: true,
      status: true,
      platform: true,
      platformChannelId: true,
      visibility: true,
      startedAt: true,
      endedAt: true,
      _count: { select: { songRequests: true } },
    },
    orderBy: { startedAt: 'desc' },
    take: 1,
  },
  _count: {
    select: {
      songs: true,
      categories: true,
      artists: true,
      managers: true,
      userFavorites: true,
      verifications: true,
      liveSessions: true,
      emoticons: true,
      schedules: true,
      playlists: true,
      clipChannels: true,
    },
  },
} satisfies Prisma.ChannelSelect;

const channelDetailSelect = {
  ...channelListSelect,
  topBannerUrl: true,
  leftBannerUrl: true,
  leftBannerLink: true,
  rightBannerUrl: true,
  rightBannerLink: true,
  scheduleNotice: true,
  guestbookEnabled: true,
  additionalLinks: true,
  profile: {
    select: {
      birthday: true,
      residence: true,
      heightCm: true,
      weightKg: true,
      nationality: true,
      gender: true,
      agency: true,
      nickname: true,
      fandomName: true,
      mbti: true,
      debutDate: true,
      bio: true,
      homeDescription: true,
      links: true,
      broadcastingPlatforms: true,
    },
  },
  managers: {
    select: {
      id: true,
      userId: true,
      canManageContent: true,
      canManageSettings: true,
      canManageProfile: true,
      canManageGuestbook: true,
      canManageCustomization: true,
      canManageEmoticons: true,
      canManageHuyeorChat: true,
      isActive: true,
      grantedByUserId: true,
      createdAt: true,
      revokedAt: true,
      user: {
        select: { id: true, email: true, nickname: true },
      },
      grantedByUser: {
        select: { id: true, email: true, nickname: true },
      },
    },
    orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
  },
  liveSessions: {
    select: {
      id: true,
      status: true,
      platform: true,
      platformChannelId: true,
      visibility: true,
      startedAt: true,
      endedAt: true,
      _count: { select: { songRequests: true } },
    },
    orderBy: { startedAt: 'desc' },
    take: 10,
  },
  channelTransferRequests: {
    select: {
      id: true,
      status: true,
      currentOwnerUserId: true,
      targetUserId: true,
      targetEmail: true,
      rejectReason: true,
      reviewedAt: true,
      createdAt: true,
      targetUser: {
        select: { id: true, email: true, nickname: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  },
  clipSettings: {
    select: {
      autoClipEnabled: true,
      updatedAt: true,
    },
  },
  pricingSettings: {
    select: {
      defaultPrice: true,
      difficultyPrices: true,
      pricingEnabled: true,
      updatedAt: true,
    },
  },
  youtubeChannels: {
    select: {
      id: true,
      youtubeChannelId: true,
      channelTitle: true,
      customUrl: true,
      subscriberCount: true,
      streamRecognitionEnabled: true,
      clipMatchingPrimary: true,
      isActive: true,
      lastSyncedAt: true,
      lastErrorAt: true,
      lastErrorCode: true,
    },
    orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
  },
} satisfies Prisma.ChannelSelect;

type ChannelListEntity = Prisma.ChannelGetPayload<{
  select: typeof channelListSelect;
}>;

type ChannelDetailEntity = Prisma.ChannelGetPayload<{
  select: typeof channelDetailSelect;
}>;

@Injectable()
export class AdminChannelService {
  constructor(private readonly prisma: PrismaService) {}

  async listChannels(
    query: AdminChannelListQueryDto,
  ): Promise<AdminChannelListResponseDto> {
    const page = query.page ?? 1;
    const pageSize = Math.min(
      query.pageSize ?? DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    );
    const where = this.buildWhere(query);
    const orderBy = this.buildOrderBy(query.sortBy, query.sortOrder);

    const [total, items] = await this.prisma.$transaction([
      this.prisma.channel.count({ where }),
      this.prisma.channel.findMany({
        where,
        select: channelListSelect,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      total,
      page,
      pageSize,
      items: items.map((item) => this.toListItem(item)),
    };
  }

  async getChannelDetail(channelId: number): Promise<AdminChannelDetailDto> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: channelDetailSelect,
    });

    if (!channel) {
      throw new ResourceNotFoundException('채널을 찾을 수 없습니다.');
    }

    return this.toDetail(channel);
  }

  private buildWhere(
    query: AdminChannelListQueryDto,
  ): Prisma.ChannelWhereInput {
    const and: Prisma.ChannelWhereInput[] = [];

    if (query.search?.trim()) {
      const keyword = query.search.trim();
      const contains = { contains: keyword };
      const orConditions: Prisma.ChannelWhereInput[] = [
        { name: contains },
        { webPath: contains },
        { platformUrl: contains },
        { user: { email: contains } },
        { user: { nickname: contains } },
      ];
      const numericKeyword = Number(keyword);
      if (Number.isInteger(numericKeyword) && numericKeyword > 0) {
        orConditions.push({ id: numericKeyword });
        orConditions.push({ userId: numericKeyword });
      }
      and.push({ OR: orConditions });
    }

    if (query.visibility) {
      and.push({ visibility: query.visibility });
    }

    if (query.ownerUserId) {
      and.push({ userId: query.ownerUserId });
    }

    if (query.createdFrom || query.createdTo) {
      and.push({
        createdAt: {
          ...(query.createdFrom ? { gte: new Date(query.createdFrom) } : {}),
          ...(query.createdTo ? { lte: new Date(query.createdTo) } : {}),
        },
      });
    }

    if (query.platform || query.verificationStatus) {
      and.push({
        verifications: {
          some: {
            ...(query.platform ? { platform: query.platform } : {}),
            ...(query.verificationStatus
              ? { status: query.verificationStatus }
              : { status: { not: ChannelVerificationStatus.REVOKED } }),
          },
        },
      });
    }

    if (query.hasActiveLive !== undefined) {
      const activeLiveCondition: Prisma.ChannelWhereInput = {
        liveSessions: {
          some: {
            status: LiveSessionStatus.ACTIVE,
            sessionType: LiveSessionType.STANDARD,
          },
        },
      };
      and.push(
        query.hasActiveLive
          ? activeLiveCondition
          : { NOT: activeLiveCondition },
      );
    }

    if (query.isGlobalEnabled !== undefined) {
      if (query.isGlobalEnabled) {
        and.push({
          OR: [
            { globalProfile: { is: null } },
            { globalProfile: { is: { globalEnabled: true } } },
          ],
        });
      } else {
        and.push({ globalProfile: { is: { globalEnabled: false } } });
      }
    }

    return and.length > 0 ? { AND: and } : {};
  }

  private buildOrderBy(
    sortBy?: AdminChannelSortBy,
    sortOrder?: AdminChannelSortOrder,
  ): Prisma.ChannelOrderByWithRelationInput {
    const order = sortOrder ?? (sortBy === 'name' ? 'asc' : 'desc');
    switch (sortBy ?? 'createdAt') {
      case 'id':
        return { id: order };
      case 'name':
        return { name: order };
      case 'updatedAt':
        return { updatedAt: order };
      case 'createdAt':
      default:
        return { createdAt: order };
    }
  }

  private toListItem(channel: ChannelListEntity): AdminChannelListItemDto {
    return {
      id: channel.id,
      userId: channel.userId,
      name: channel.name,
      webPath: channel.webPath,
      platformUrl: channel.platformUrl,
      profileImageUrl: channel.profileImageUrl,
      themeColor: channel.themeColor,
      visibility: channel.visibility,
      channelDescription: channel.channelDescription,
      createdAt: channel.createdAt,
      updatedAt: channel.updatedAt,
      owner: channel.user,
      counts: this.mapCounts(channel._count),
      verifications: channel.verifications,
      globalProfile: channel.globalProfile,
      customization: channel.customization,
      songRequestSettings: channel.songRequestSettings,
      latestLiveSession: this.mapLiveSession(channel.liveSessions[0]),
    };
  }

  private toDetail(channel: ChannelDetailEntity): AdminChannelDetailDto {
    return {
      ...this.toListItem(channel),
      topBannerUrl: channel.topBannerUrl,
      leftBannerUrl: channel.leftBannerUrl,
      leftBannerLink: channel.leftBannerLink,
      rightBannerUrl: channel.rightBannerUrl,
      rightBannerLink: channel.rightBannerLink,
      scheduleNotice: channel.scheduleNotice,
      guestbookEnabled: channel.guestbookEnabled,
      additionalLinks: channel.additionalLinks,
      profile: channel.profile,
      managers: channel.managers,
      recentLiveSessions: channel.liveSessions.map((session) =>
        this.mapLiveSession(session),
      ),
      transferRequests: channel.channelTransferRequests,
      clipSettings: channel.clipSettings,
      pricingSettings: channel.pricingSettings,
      externalBindings: {
        youtubeChannels: channel.youtubeChannels,
      },
    };
  }

  private mapCounts(counts: ChannelListEntity['_count']) {
    return {
      songs: counts.songs,
      categories: counts.categories,
      artists: counts.artists,
      managers: counts.managers,
      favorites: counts.userFavorites,
      verifications: counts.verifications,
      liveSessions: counts.liveSessions,
      emoticons: counts.emoticons,
      schedules: counts.schedules,
      playlists: counts.playlists,
      clips: counts.clipChannels,
    };
  }

  private mapLiveSession(
    session: ChannelListEntity['liveSessions'][number] | undefined,
  ) {
    if (!session) return null;
    return {
      id: session.id,
      status: session.status,
      platform: session.platform,
      platformChannelId: session.platformChannelId,
      visibility: session.visibility,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      songRequestCount: session._count.songRequests,
    };
  }
}
