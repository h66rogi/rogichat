import { Prisma, ChannelVerificationStatus } from '@prisma/client';

export const channelBaseSelect = {
  id: true,
  name: true,
  webPath: true,
  platformUrl: true,
  topBannerUrl: true,
  leftBannerUrl: true,
  leftBannerLink: true,
  rightBannerUrl: true,
  rightBannerLink: true,
  profileImageUrl: true,
  additionalLinks: true,
  themeColor: true,
  channelDescription: true,
  scheduleNotice: true,
  visibility: true,
  createdAt: true,
  updatedAt: true,
  verifications: {
    select: { status: true, platform: true, platformChannelId: true },
    where: { status: { not: ChannelVerificationStatus.REVOKED } },
  },
  // 활성 부여형 뱃지(설립자 등). isFounder 계산용. 보통 0~1행이라 join 비용 미미.
  channelBadges: {
    select: { type: true },
    where: { revokedAt: null },
  },
} satisfies Prisma.ChannelSelect;

export const channelWithCountsSelect = {
  ...channelBaseSelect,
  _count: { select: { songs: true, categories: true, artists: true } },
} satisfies Prisma.ChannelSelect;

const globalProfileSubSelect = {
  select: {
    globalEnabled: true,
    globalName: true,
    globalDescription: true,
    globalProfileImageUrl: true,
    primaryLocale: true,
  },
} as const;

/**
 * meloming.gg 글로벌 mirror 응답용 select.
 * channels 의 기본 정보 + _count + globalProfile (override 필드).
 * 프론트에서 globalProfile.globalName ?? channel.name 패턴으로 적용한다.
 */
export const channelWithGlobalProfileSelect = {
  ...channelWithCountsSelect,
  globalProfile: globalProfileSubSelect,
} satisfies Prisma.ChannelSelect;

export type ChannelWithGlobalProfile = Prisma.ChannelGetPayload<{
  select: typeof channelWithGlobalProfileSelect;
}>;

const channelUserSubSelect = {
  select: {
    id: true,
    nickname: true,
    isIdentityVerified: true,
    isProSubscriber: true,
    proSubscriptionEndAt: true,
    isAmbassador: true,
  },
} as const;

const channelCustomizationSubSelect = {
  select: {
    customCss: true,
    isEnabled: true,
    customCssNew: true,
    isEnabledNew: true,
    layoutType: true,
    forcedColorMode: true,
    layoutWidth: true,
    headerStyle: true,
  },
} as const;

const channelGlobalProfileSubSelect = {
  select: {
    globalEnabled: true,
    globalName: true,
    globalDescription: true,
    globalProfileImageUrl: true,
    primaryLocale: true,
  },
} as const;

export const channelWithUserAndCountsSelect = {
  ...channelWithCountsSelect,
  userId: true,
  user: channelUserSubSelect,
  customization: channelCustomizationSubSelect,
  globalProfile: channelGlobalProfileSubSelect,
} satisfies Prisma.ChannelSelect;

const channelVoiceCommissionSubSelect = {
  select: {
    isActive: true,
    acceptingOrders: true,
    products: {
      where: { isActive: true, deletedAt: null },
      select: { id: true },
      take: 1,
    },
  },
} as const;

const channelHomeworkSongSubSelect = {
  select: { isActive: true },
} as const;

// _count 없이 user 정보만 포함하는 selection (최적화용)
export const channelWithUserSelect = {
  ...channelBaseSelect,
  userId: true,
  user: channelUserSubSelect,
  customization: channelCustomizationSubSelect,
  globalProfile: channelGlobalProfileSubSelect,
  voiceCommission: channelVoiceCommissionSubSelect,
  homeworkSong: channelHomeworkSongSubSelect,
} satisfies Prisma.ChannelSelect;

export type ChannelBase = Prisma.ChannelGetPayload<{
  select: typeof channelBaseSelect;
}>;
export type ChannelWithCounts = Prisma.ChannelGetPayload<{
  select: typeof channelWithCountsSelect;
}>;
export type ChannelWithUserAndCounts = Prisma.ChannelGetPayload<{
  select: typeof channelWithUserAndCountsSelect;
}>;
export type ChannelWithUser = Prisma.ChannelGetPayload<{
  select: typeof channelWithUserSelect;
}>;

// _count를 별도로 조회한 후 합친 결과 타입
export type ChannelWithUserAndCountsOptimized = ChannelWithUser & {
  _count: { songs: number; categories: number; artists: number };
};
