import { apiClient } from "@/meloming/shared/lib/api-client";
import type {
  KaraokePlaybackMode,
  KaraokeVideoType,
} from "./session";
import type { SongRequestMode } from "./public-session";

/**
 * 채널 단위 신청곡 설정.
 *
 * 2026-05-14 P0 재설계 — LiveSessionSettings(라이브 1:1) 가 라이브 비활성 시 변경
 * 불가능했던 결함을 ChannelSongRequestSettings(channel 1:1) 도입으로 해소.
 * paused/requestEnabled 는 라이브 한정이라 본 응답/요청에서 제외.
 */
export interface ChannelSongRequestSettings {
  channelId: number;
  requestCommand: string;
  maxQueueSize: number;
  donationPriorityEnabled: boolean;
  enforceDonationMinimumPrice: boolean;
  karaokePlaybackMode: KaraokePlaybackMode;
  karaokeVideoType: KaraokeVideoType;
  donationOnlyEnabled: boolean;
  requestMode: SongRequestMode;
  chatRequestEnabled: boolean;
  donationRequestEnabled: boolean;
  allowAnonymous: boolean;
  requireSongMatch: boolean;
  randomRequestEnabled: boolean;
  preventDuplicateSongs: boolean;
  blockedCategoryIds: number[];
  maxRequestsPerUser: number;
  maxTotalRequests: number;
  showRequesterName: boolean;
}

export type UpdateChannelSongRequestSettingsDto = Partial<
  Omit<ChannelSongRequestSettings, "channelId">
>;

export async function getChannelSongRequestSettings(
  channelId: number,
): Promise<ChannelSongRequestSettings> {
  const response = await apiClient.get<ChannelSongRequestSettings>(
    `/channel/${channelId}/song-request-settings`,
    { withCredentials: true },
  );
  return response.data;
}

export async function updateChannelSongRequestSettings(
  channelId: number,
  dto: UpdateChannelSongRequestSettingsDto,
): Promise<ChannelSongRequestSettings> {
  const response = await apiClient.patch<ChannelSongRequestSettings>(
    `/channel/${channelId}/song-request-settings`,
    dto,
    { withCredentials: true },
  );
  return response.data;
}
