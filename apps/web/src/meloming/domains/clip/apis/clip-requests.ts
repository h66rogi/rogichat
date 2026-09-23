import { apiClient } from "@/meloming/shared/lib/api-client";
import type {
  ClipRequest,
  ChannelClipPermission,
  CreateClipRequestBody,
  RejectClipRequestBody,
  GetClipRequestsQuery,
  GetClipRequestsResponse,
} from "@/meloming/domains/clip/types/clip-request";

// ---------------------------------------------------------------------------
// Clip Request APIs
// ---------------------------------------------------------------------------

/**
 * GET /clips/channels/:channelId/permission
 * - 채널 클립 등록 권한 체크
 */
export async function getChannelClipPermission(
  channelId: number
): Promise<ChannelClipPermission> {
  const response = await apiClient.get<ChannelClipPermission>(
    `/clips/channels/${channelId}/permission`,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * POST /clips/requests
 * - 클립 등록 신청
 */
export async function createClipRequest(
  body: CreateClipRequestBody
): Promise<ClipRequest> {
  const response = await apiClient.post<ClipRequest>("/clips/requests", body, {
    withCredentials: true,
  });
  return response.data;
}

/**
 * GET /clips/requests/channel/:channelId
 * - 채널 클립 신청 목록 조회 (채널 관리자용)
 */
export async function getChannelClipRequests(
  channelId: number,
  params: GetClipRequestsQuery = {}
): Promise<GetClipRequestsResponse> {
  const response = await apiClient.get<GetClipRequestsResponse>(
    `/clips/requests/channel/${channelId}`,
    { params, withCredentials: true }
  );
  return response.data;
}

/**
 * PATCH /clips/requests/:id/approve
 * - 클립 신청 승인
 */
export async function approveClipRequest(id: number): Promise<ClipRequest> {
  const response = await apiClient.patch<ClipRequest>(
    `/clips/requests/${id}/approve`,
    {},
    { withCredentials: true }
  );
  return response.data;
}

/**
 * PATCH /clips/requests/:id/reject
 * - 클립 신청 거절
 */
export async function rejectClipRequest(
  id: number,
  body: RejectClipRequestBody = {}
): Promise<ClipRequest> {
  const response = await apiClient.patch<ClipRequest>(
    `/clips/requests/${id}/reject`,
    body,
    { withCredentials: true }
  );
  return response.data;
}
