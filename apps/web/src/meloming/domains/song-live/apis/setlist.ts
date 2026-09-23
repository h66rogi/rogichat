import { apiClient } from "@/meloming/shared/lib/api-client";
import type {
  ManageSetlistsResponse,
  PublicSetlistAvailabilityResponse,
  PublicSetlistDetailResponse,
  PublicSetlistsResponse,
  SetlistVisibility,
  UpdateSetlistVisibilityResponse,
} from "../types/setlist";

/**
 * GET /v1/song-live/public/setlists
 * 공개 셋리스트 목록 (재생 완료된 곡이 있는 종료 세션만, 최신순)
 */
export async function getPublicSetlists(
  identifier: string,
  page: number = 1,
  limit: number = 20
): Promise<PublicSetlistsResponse> {
  const response = await apiClient.get<PublicSetlistsResponse>(
    "/song-live/public/setlists",
    { params: { identifier, page, limit } }
  );
  return response.data;
}

/**
 * GET /v1/song-live/public/setlists/:sessionId
 * 특정 종료 세션의 셋리스트 상세 (재생 완료된 곡, 시간순)
 */
export async function getPublicSetlistDetail(
  identifier: string,
  sessionId: number
): Promise<PublicSetlistDetailResponse> {
  const response = await apiClient.get<PublicSetlistDetailResponse>(
    `/song-live/public/setlists/${sessionId}`,
    { params: { identifier } }
  );
  return response.data;
}

/**
 * GET /v1/song-live/public/setlists/availability
 * 채널 메뉴 사이드바(신규 레이아웃)에서 셋리스트 탭 노출 여부를 client-side로 판정.
 * server 컴포넌트 밖(GlobalShell 하위 ChannelShell)에서 호출되므로 client 버전이 필요.
 */
export async function getChannelSetlistAvailability(
  identifier: string
): Promise<PublicSetlistAvailabilityResponse> {
  const response = await apiClient.get<PublicSetlistAvailabilityResponse>(
    "/song-live/public/setlists/availability",
    { params: { identifier } }
  );
  return response.data;
}

/**
 * GET /v1/song-live/manage/setlists
 * 채널 owner / canManageContent 매니저용 셋리스트 관리 목록 (PUBLIC + PRIVATE 포함)
 */
export async function getManageSetlists(
  identifier: string,
  page: number = 1,
  limit: number = 20
): Promise<ManageSetlistsResponse> {
  const response = await apiClient.get<ManageSetlistsResponse>(
    "/song-live/manage/setlists",
    { params: { identifier, page, limit } }
  );
  return response.data;
}

/**
 * PATCH /v1/song-live/manage/setlists/:sessionId/visibility
 * 셋리스트 (LiveSession) 가시성 토글. 결과는 새 visibility 만 반환.
 */
export async function updateSetlistVisibility(
  identifier: string,
  sessionId: number,
  visibility: SetlistVisibility
): Promise<UpdateSetlistVisibilityResponse> {
  const response = await apiClient.patch<UpdateSetlistVisibilityResponse>(
    `/song-live/manage/setlists/${sessionId}/visibility`,
    { visibility },
    { params: { identifier } }
  );
  return response.data;
}
