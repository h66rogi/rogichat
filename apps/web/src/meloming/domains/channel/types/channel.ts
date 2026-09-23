import type { CommonPagination } from "@/meloming/shared/types/common";
import type {
  ChannelCustomizationColorMode,
  ChannelLayoutWidth,
  ChannelHeaderStyle,
  ChannelLayoutType,
} from "@/meloming/domains/channel/types/customization";

/**
 * Domain
 */
export interface Channel {
  id: number;
  name: string;
  webPath: string;
  platformUrl: string | null;
  profileImageUrl: string | null;
  topBannerUrl: string | null;
  leftBannerUrl: string | null;
  leftBannerLink: string | null;
  rightBannerUrl: string | null;
  rightBannerLink: string | null;
  additionalLinks: { name: string; url: string }[];
  themeColor: string;
  channelDescription: string;
  createdAt: string;
  updatedAt: string;
  _count: {
    songs: number;
    artists: number;
    categories: number;
  };
  /**
   * 커스텀 CSS (isEnabled: true인 경우에만 포함)
   * Pro 구독자의 채널 커스터마이징 CSS
   */
  customCss?: string | null;
  /**
   * 커스텀 CSS가 적용된 경우 강제할 색상 모드
   */
  forcedColorMode?: ChannelCustomizationColorMode | null;
  /** 채널 레이아웃 너비 (PRO 전용) */
  layoutWidth?: ChannelLayoutWidth | null;
  /** 채널 상단 보기 방식 (PRO 전용) */
  headerStyle?: ChannelHeaderStyle | null;
  /**
   * 채널 페이지 레이아웃 타입 (PRO 무관 항상 응답, 별도 설정 없으면 new).
   * - legacy: 기존 가로 탭 레이아웃
   * - new: 신규 메뉴 사이드바 레이아웃
   */
  layoutType?: ChannelLayoutType;
  /** 채널 소유자 PRO 구독 여부 */
  isOwnerProSubscriber?: boolean;
  /** 채널 소유자 앰배서더 여부 */
  isOwnerAmbassador?: boolean;
  /** 멜로밍 1주년 설립자 뱃지 보유 여부 */
  isFounder?: boolean;
  /** 채널 인증 여부 (플랫폼 소유권 검증 완료) */
  isVerified?: boolean;
  /** 채널 인증 목록 (복수 플랫폼) */
  verifications?: { platform: string; platformChannelId: string | null }[];
  /** 일정 공지 */
  scheduleNotice?: string | null;
  /** 채널 공개 범위 */
  visibility?: 'PUBLIC' | 'UNLISTED';
}

export interface ChannelWithIsOwner extends Channel {
  isOwner: boolean;
}

export interface ChannelStats {
  songCount: number;
  artistCount: number;
  categoryCount: number;
}

/**
 * Dto
 */

export type GetChannelMyResponse = ChannelWithIsOwner[];

export type PutChannelIdentifierRequestBody = Omit<
  Channel,
  "id" | "createdAt" | "updatedAt" | "_count"
>;

export type GetChannelIdentifierResponse =
  | Channel
  | (Channel & { stats: ChannelStats });

export interface GetChannelSearchRequestQuery {
  keyword: string;
  page: number;
  limit: number;
  expand: boolean;
}

export interface GetChannelSearchResponse {
  channels: (Omit<
    Channel,
    | "leftBannerUrl"
    | "leftBannerLink"
    | "rightBannerUrl"
    | "rightBannerLink"
    | "additionalLinks"
    | "createdAt"
    | "updatedAt"
    | "_count"
  > & {
    relevanceScore: number;
    user: {
      id: number;
      name: string;
      profileImageUrl: string | null;
    };
    /**
     * 새 API에서 제공되는 즐겨찾기 상태 (비로그인 시 항상 false)
     */
    isFavorite?: boolean;
    /** 채널 소유자 PRO 구독 여부 */
    isOwnerProSubscriber?: boolean;
    /** 채널 소유자 앰배서더 여부 */
    isOwnerAmbassador?: boolean;
    /** 멜로밍 1주년 설립자 뱃지 보유 여부 */
    isFounder?: boolean;
    /** 채널 인증 여부 */
    isVerified?: boolean;
  })[];
  pagination: CommonPagination;
}

export interface GetChannelIdentifierPermissionResponse {
  view: boolean;
  manageContent: boolean;
  manageSettings: boolean;
  manageProfile: boolean;
  manageGuestbook: boolean;
  manageCustomization: boolean;
  manageEmoticons: boolean;
  isOwner: boolean;
  /**
   * 채널 소유자가 PRO 구독자인지 여부
   * 매니저의 경우 채널 주인의 PRO 상태에 따라 기능 접근이 달라짐
   */
  isOwnerProSubscriber: boolean;
}

/**
 * Channel list DTOs for channel discovery surfaces
 */
export interface ChannelListItem {
  id: number;
  name: string;
  webPath: string;
  platformUrl: string;
  topBannerUrl: string | null;
  leftBannerUrl: string | null;
  leftBannerLink: string | null;
  rightBannerUrl: string | null;
  rightBannerLink: string | null;
  profileImageUrl: string | null;
  themeColor: string;
  channelDescription: string | null;
  _count: {
    songs: number;
    categories: number;
    artists: number;
  };
  createdAt: string;
  updatedAt: string;
  favoritesCount: number | null;
  songLikesCount: number | null;
  songsCount: number | null;
  popularityScore: number | null;
  /** 채널 소유자 PRO 구독 여부 */
  isOwnerProSubscriber?: boolean;
  /** 채널 소유자 앰배서더 여부 */
  isOwnerAmbassador?: boolean;
  /** 멜로밍 1주년 설립자 뱃지 보유 여부 */
  isFounder?: boolean;
  /** 채널 인증 여부 */
  isVerified?: boolean;
}

export interface ChannelListItemWithGroup extends ChannelListItem {
  group: string;
}

export interface GetFamousChannelsRequestQuery {
  limit?: number;
}

export type GetFamousChannelsResponse = ChannelListItem[];

export interface GetRecentChannelsRequestQuery {
  limit?: number;
}

export type GetRecentChannelsResponse = ChannelListItem[];

export interface GetAllChannelsResponse {
  channels: ChannelListItemWithGroup[];
  groups: string[];
}
