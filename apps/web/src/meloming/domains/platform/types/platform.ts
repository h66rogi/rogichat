export const PLATFORM = {
  SOOP: "SOOP",
  CHZZK: "CHZZK",
  CIME: "CIME",
  OTHER: "OTHER",
} as const;

export type Platform = (typeof PLATFORM)[keyof typeof PLATFORM];

export const STREAM_PLATFORM = {
  SOOP: "SOOP",
  CHZZK: "CHZZK",
  CIME: "CIME",
  OTHER: "OTHER",
} as const;

export type StreamPlatform =
  (typeof STREAM_PLATFORM)[keyof typeof STREAM_PLATFORM];

export const PLATFORM_BY_URL = {
  SOOP: "SOOP",
  CHZZK: "CHZZK",
  CIME: "CIME",
  OTHER: "OTHER",
} as const;

export type PlatformByUrl =
  (typeof PLATFORM_BY_URL)[keyof typeof PLATFORM_BY_URL];

export interface GetPlatformByUrlRequestQuery {
  url: string;
}

export interface GetPlatformByUrlResponseDto {
  platform: PlatformByUrl;
  channelId: string | null;
  isBroadcasting: boolean | null;
  grade: "NORMAL" | "BEST" | "PARTNER" | string | null;
  profileImageUrl: string | null;
  channelName: string | null;
  followers: number | null;
  broadcastTime: number | null;
}
