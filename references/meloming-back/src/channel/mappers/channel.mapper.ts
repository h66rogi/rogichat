import {
  ChannelMyResponseDto,
  ChannelSummaryDto,
  ChannelDetailDto,
  ChannelSearchItemDto,
  ChannelWithCountsDto,
} from '../dto/channel.response.dto';
import {
  ChannelWithCounts,
  ChannelWithUserAndCounts,
} from '../prisma/channel.selections';
import {
  type ChannelVisibility,
  ChannelVerificationStatus,
  type StreamPlatform,
} from '@prisma/client';
import { toChannelColorModeValue } from '../customization/constants/color-mode';
import { toChannelLayoutWidthValue } from '../customization/constants/layout-width';
import { toChannelHeaderStyleValue } from '../customization/constants/header-style';
import { toChannelLayoutTypeValue } from '../customization/constants/layout-type';

/** 채널에 APPROVED 상태의 인증이 있는지 확인 */
export function hasApprovedVerification(
  verifications?: { status: ChannelVerificationStatus }[],
): boolean {
  return (
    verifications?.some(
      (v) => v.status === ChannelVerificationStatus.APPROVED,
    ) ?? false
  );
}

type MinimalChannelShape = {
  id: number;
  name: string;
  webPath: string;
  platformUrl: string | null | undefined;
  topBannerUrl: string | null | undefined;
  leftBannerUrl?: string | null | undefined;
  leftBannerLink?: string | null | undefined;
  rightBannerUrl?: string | null | undefined;
  rightBannerLink?: string | null | undefined;
  profileImageUrl: string | null | undefined;
  themeColor: string;
  channelDescription: string | null | undefined;
  scheduleNotice?: string | null | undefined;
  additionalLinks?: unknown; // Prisma JsonValue와 호환
  verifications?: {
    status: ChannelVerificationStatus;
    platform?: StreamPlatform;
    platformChannelId?: string | null;
  }[];
  channelBadges?: { type: string }[];
  visibility?: ChannelVisibility;
};

/** 채널에 활성(미회수) 설립자 뱃지가 있는지 확인 */
export function hasFounderBadge(badges?: { type: string }[]): boolean {
  return badges?.some((b) => b.type === 'FOUNDER') ?? false;
}

export function toChannelSummaryDto(
  channel: MinimalChannelShape,
): ChannelSummaryDto {
  return {
    id: channel.id,
    name: channel.name,
    webPath: channel.webPath,
    platformUrl: channel.platformUrl ?? null,
    topBannerUrl: channel.topBannerUrl ?? null,
    leftBannerUrl: channel.leftBannerUrl ?? null,
    leftBannerLink: channel.leftBannerLink ?? null,
    rightBannerUrl: channel.rightBannerUrl ?? null,
    rightBannerLink: channel.rightBannerLink ?? null,
    profileImageUrl: channel.profileImageUrl ?? null,
    themeColor: channel.themeColor,
    channelDescription: channel.channelDescription ?? null,
    scheduleNotice: channel.scheduleNotice ?? null,
    additionalLinks:
      (channel.additionalLinks as Array<{
        name: string;
        url: string;
      }> | null) ?? null,
    isVerified: hasApprovedVerification(channel.verifications),
    verifications: (channel.verifications ?? [])
      .filter(
        (
          v,
        ): v is {
          status: ChannelVerificationStatus;
          platform: StreamPlatform;
          platformChannelId: string | null;
        } => v.status === ChannelVerificationStatus.APPROVED && !!v.platform,
      )
      .map((v) => ({
        platform: v.platform,
        platformChannelId: v.platformChannelId ?? null,
      })),
    visibility: channel.visibility ?? 'PUBLIC',
    isFounder: hasFounderBadge(channel.channelBadges),
  };
}

export function toChannelMyResponseDto(
  channel: ChannelWithCounts & { isOwner: boolean },
): ChannelMyResponseDto {
  return {
    ...toChannelSummaryDto(channel),
    _count: channel._count,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
    isOwner: channel.isOwner,
  } as ChannelMyResponseDto;
}

export function toChannelWithCountsDto(
  channel: ChannelWithCounts & {
    favoritesCount?: number;
    songLikesCount?: number;
    songsCount?: number;
    popularityScore?: number;
    user?: {
      isProSubscriber: boolean | null;
      proSubscriptionEndAt: Date | null;
      isAmbassador?: boolean | null;
    } | null;
  },
): ChannelWithCountsDto {
  return {
    ...toChannelSummaryDto(channel),
    _count: channel._count,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
    ...(typeof channel.favoritesCount === 'number'
      ? { favoritesCount: channel.favoritesCount }
      : {}),
    ...(typeof channel.songLikesCount === 'number'
      ? { songLikesCount: channel.songLikesCount }
      : {}),
    ...(typeof channel.songsCount === 'number'
      ? { songsCount: channel.songsCount }
      : {}),
    ...(typeof channel.popularityScore === 'number'
      ? { popularityScore: channel.popularityScore }
      : {}),
    ...(channel.user
      ? {
          isOwnerProSubscriber: isProSubscriptionActive(channel.user),
          isOwnerAmbassador: !!channel.user.isAmbassador,
        }
      : {}),
  } as ChannelWithCountsDto & {
    favoritesCount?: number;
    songLikesCount?: number;
    songsCount?: number;
    popularityScore?: number;
  };
}

/**
 * 프로 구독 활성 상태 확인
 */
function isProSubscriptionActive(user: {
  isProSubscriber: boolean | null;
  proSubscriptionEndAt: Date | null;
}): boolean {
  if (!user.isProSubscriber) return false;
  if (!user.proSubscriptionEndAt) return false;
  return user.proSubscriptionEndAt > new Date();
}

export function toChannelDetailDto(
  channel: ChannelWithUserAndCounts,
  _currentUserId?: number,
): ChannelDetailDto {
  // 레이아웃 타입: PRO 무관 항상 응답 (별도 설정 없으면 new). 비-PRO 채널도 신규 레이아웃을 본다.
  const isProActive = isProSubscriptionActive(channel.user);
  const layoutType = toChannelLayoutTypeValue(channel.customization?.layoutType);
  const isLegacyLayout = layoutType === 'legacy';

  // 적용 CSS는 현재 레이아웃에 해당하는 것만 선택 (legacy↔customCss / new↔customCssNew).
  // 두 레이아웃의 CSS는 DOM 구조가 달라 분리 보관되며 서로 호환되지 않는다.
  const activeCss = isLegacyLayout
    ? channel.customization?.customCss
    : channel.customization?.customCssNew;
  const activeCssEnabled = isLegacyLayout
    ? channel.customization?.isEnabled
    : channel.customization?.isEnabledNew;

  // CSS 포함 로직: 프로 구독 활성 + 현재 레이아웃 CSS 활성화 시에만 포함
  const customCss = isProActive && activeCssEnabled ? activeCss : undefined;
  const forcedColorMode =
    isProActive && activeCssEnabled
      ? toChannelColorModeValue(channel.customization?.forcedColorMode)
      : undefined;
  // layoutWidth, headerStyle은 PRO 활성 시에만 포함 (legacy 레이아웃 전용 옵션)
  const layoutWidth = isProActive
    ? toChannelLayoutWidthValue(channel.customization?.layoutWidth)
    : undefined;
  const headerStyle = isProActive
    ? toChannelHeaderStyleValue(channel.customization?.headerStyle)
    : undefined;

  return {
    ...toChannelSummaryDto(channel),
    user: {
      id: channel.user.id,
      nickname: channel.user.nickname,
    },
    _count: channel._count,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
    customCss,
    forcedColorMode,
    layoutWidth,
    headerStyle,
    layoutType,
    isOwnerProSubscriber: isProActive,
    isOwnerAmbassador: !!(channel.user as any).isAmbassador,
    voiceCommissionActive: isPublicVoiceCommissionActive(channel),
    homeworkSongActive:
      (channel as { homeworkSong?: { isActive: boolean } | null })
        .homeworkSong?.isActive ?? false,
    // meloming.gg(글로벌 mirror) override + opt-in 토글.
    // row 미존재 시 null. 글로벌 mirror 는 globalProfile?.globalEnabled === true 인 경우만 노출.
    globalProfile: (channel as { globalProfile?: unknown }).globalProfile ?? null,
  } as ChannelDetailDto;
}

function isPublicVoiceCommissionActive(
  channel: MinimalChannelShape & {
    user?: { isIdentityVerified?: boolean | null } | null;
    voiceCommission?: {
      isActive: boolean;
      acceptingOrders?: boolean | null;
      products?: { id: number }[];
    } | null;
  },
): boolean {
  const voiceCommission = channel.voiceCommission;
  return Boolean(
    voiceCommission?.isActive &&
      voiceCommission.acceptingOrders &&
      voiceCommission.products?.length &&
      channel.user?.isIdentityVerified &&
      hasApprovedVerification(channel.verifications),
  );
}

export function toChannelSearchItemDto(
  channel: MinimalChannelShape & {
    user?: {
      id: number;
      nickname: string;
      profileImageUrl: string | null;
      isProSubscriber?: boolean | null;
      proSubscriptionEndAt?: Date | null;
      isAmbassador?: boolean | null;
    } | null;
    relevanceScore: number;
    isFavorite?: boolean;
  },
): ChannelSearchItemDto {
  return {
    ...toChannelSummaryDto(channel),
    user: channel.user
      ? {
          id: channel.user.id,
          nickname: channel.user.nickname,
          profileImageUrl: channel.user.profileImageUrl,
        }
      : null,
    relevanceScore: channel.relevanceScore,
    isFavorite: !!channel.isFavorite,
    isOwnerProSubscriber: channel.user
      ? isProSubscriptionActive({
          isProSubscriber: channel.user.isProSubscriber ?? null,
          proSubscriptionEndAt: channel.user.proSubscriptionEndAt ?? null,
        })
      : false,
    isOwnerAmbassador: !!channel.user?.isAmbassador,
  };
}
