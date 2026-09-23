import type { CommonPagination } from "@/meloming/shared/types/common";
import type { ProfileAnniversaries } from "@/meloming/domains/channel-profile/types/profile";

/**
 * Favorites domain types
 */

export interface FavoriteToggleResponse {
  success: true;
  isFavorite: boolean;
  message: string;
}

export interface FavoriteChannelItem {
  id: number;
  channelId: number;
  channelName: string;
  webPath: string;
  profileImageUrl: string | null;
  themeColor: string;
  ownerNickname: string;
  isOwnerProSubscriber?: boolean; // 채널 소유자 PRO 구독 여부
  isOwnerAmbassador?: boolean; // 채널 소유자 앰배서더 여부
  isFounder?: boolean; // 멜로밍 1주년 설립자 뱃지 여부
  isVerified?: boolean; // 채널 인증 여부
  createdAt: string; // ISO date
}

export interface FavoriteSongItem {
  id: number;
  songId: number;
  songTitle: string;
  artistName: string;
  albumArt: string;
  channelName: string;
  channelProfileImageUrl: string | null;
  webPath: string;
  createdAt: string; // ISO date
}

export type GetFavoritesChannelsResponse = {
  favorites: FavoriteChannelItem[];
} & CommonPagination;

export type GetFavoritesSongsResponse = {
  favorites: FavoriteSongItem[];
} & CommonPagination;

export interface FavoriteStatusResponse {
  isFavorite: boolean;
  createdAt?: string; // present when true
}

export interface FavoritesStatsResponse {
  myChannelFavorites: number;
  mySongFavorites: number;
}

export interface SongFavoritesCountResponse {
  songId: number;
  totalFavorites: number;
}

export interface ChannelFavoritesCountResponse {
  channelId: number;
  totalFavorites: number;
}

export interface FavoriteUserItem {
  userId: number;
  nickname: string;
  profileImageUrl: string;
  createdAt: string;
}

export interface GetFavoritesChannelUsersResponse {
  users: FavoriteUserItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * GET /favorites/channels/anniversaries
 * 즐겨찾기 채널 기념일 정보
 */
export interface FavoriteChannelAnniversariesItem {
  channelId: number;
  channelName: string;
  webPath: string;
  profileImageUrl?: string | null;
  themeColor?: string | null;
  anniversaries?: ProfileAnniversaries | null;
}

export interface GetFavoriteChannelAnniversariesResponse {
  items: FavoriteChannelAnniversariesItem[];
}

// End of types
