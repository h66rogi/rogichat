import { apiClient } from "@/meloming/shared/lib/api-client";
import type {
  SongAddRequest,
  ChannelSongPermission,
  CreateSongAddRequestBody,
  ApproveSongAddRequestBody,
  RejectSongAddRequestBody,
  GetSongAddRequestsQuery,
  GetSongAddRequestsResponse,
} from "@/meloming/domains/channel/types/song-request";

// ---------------------------------------------------------------------------
// Song Add Request APIs
// ---------------------------------------------------------------------------

/**
 * GET /songs/channels/:channelId/permission
 * - 채널 노래 등록 권한 체크
 */
export async function getChannelSongPermission(
  channelId: number
): Promise<ChannelSongPermission> {
  const response = await apiClient.get<ChannelSongPermission>(
    `/songs/channels/${channelId}/permission`,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * POST /songs/requests
 * - 노래 등록 신청
 */
export async function createSongAddRequest(
  body: CreateSongAddRequestBody
): Promise<SongAddRequest> {
  const response = await apiClient.post<SongAddRequest>("/songs/requests", body, {
    withCredentials: true,
  });
  return response.data;
}

/**
 * GET /songs/requests/channel/:channelId
 * - 채널 노래 신청 목록 조회 (채널 관리자용)
 */
export async function getChannelSongAddRequests(
  channelId: number,
  params: GetSongAddRequestsQuery = {}
): Promise<GetSongAddRequestsResponse> {
  const response = await apiClient.get<GetSongAddRequestsResponse>(
    `/songs/requests/channel/${channelId}`,
    { params, withCredentials: true }
  );
  return response.data;
}

/**
 * PATCH /songs/requests/:id/approve
 * - 노래 신청 승인 (수정된 값 포함 가능)
 */
export async function approveSongAddRequest(
  id: number,
  body?: ApproveSongAddRequestBody
): Promise<SongAddRequest> {
  const response = await apiClient.patch<SongAddRequest>(
    `/songs/requests/${id}/approve`,
    body ?? {},
    { withCredentials: true }
  );
  return response.data;
}

/**
 * PATCH /songs/requests/:id/reject
 * - 노래 신청 거절
 */
export async function rejectSongAddRequest(
  id: number,
  body: RejectSongAddRequestBody = {}
): Promise<SongAddRequest> {
  const response = await apiClient.patch<SongAddRequest>(
    `/songs/requests/${id}/reject`,
    body,
    { withCredentials: true }
  );
  return response.data;
}
