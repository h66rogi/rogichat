import { apiClient } from "@/meloming/shared/lib/api-client";
import type {
  Clip,
  GetClipsRequestQuery,
  GetClipsResponse,
  CreateClipRequestBody,
  CreateUploadedClipRequestBody,
  ClipUploadPolicy,
  UpdateClipRequestBody,
  ResolveClipRequest,
  ResolveClipResponse,
  GetAutoClipPlayUrlResponse,
  UploadedClipVideo,
  UploadedClipThumbnail,
} from "@/meloming/domains/clip/types/clip";

export const CLIP_MEDIA_UPLOAD_TIMEOUT_MS = 0;

/**
 * GET /clips/:clipId/play
 * - mediaType=DIRECT_FILE + selfHosted=true 클립의 mp4 재생용 presigned URL 발급.
 * - EMBED 클립은 platform-specific embed URL 직접 사용 (이 endpoint X).
 */
export async function getAutoClipPlayUrl(
  clipId: number
): Promise<GetAutoClipPlayUrlResponse> {
  const response = await apiClient.get<GetAutoClipPlayUrlResponse>(
    `/clips/${clipId}/play`
  );
  return response.data;
}

/**
 * GET /clips/:clipId/download
 * - selfHosted DIRECT_FILE 클립의 mp4 다운로드용 presigned URL (Content-Disposition: attachment).
 * - 메인 채널 관리자만 (백엔드 권한 검증). EMBED 클립은 원본 미보관이라 대상 X.
 */
export async function getClipDownloadUrl(
  clipId: number
): Promise<GetAutoClipPlayUrlResponse> {
  const response = await apiClient.get<GetAutoClipPlayUrlResponse>(
    `/clips/${clipId}/download`,
    { withCredentials: true }
  );
  return response.data;
}

// ---------------------------------------------------------------------------
// Clip APIs
// ---------------------------------------------------------------------------

/**
 * GET /clips/channel/:identifier
 * - 채널별 클립 목록 (커서 기반 페이지네이션)
 */
export async function getClipsByChannel(
  identifier: string,
  params: GetClipsRequestQuery = {}
): Promise<GetClipsResponse> {
  const response = await apiClient.get<GetClipsResponse>(
    `/clips/channel/${identifier}`,
    { params, withCredentials: true }
  );
  return response.data;
}

/**
 * GET /clips/hot
 * - 핫클립 목록 (커서 기반 페이지네이션)
 */
export async function getHotClips(
  params: GetClipsRequestQuery = {}
): Promise<GetClipsResponse> {
  const response = await apiClient.get<GetClipsResponse>("/clips/hot", {
    params,
    withCredentials: true,
  });
  return response.data;
}

/**
 * GET /clips/liked
 * - 좋아요한 클립 목록 (로그인 필수)
 */
export async function getLikedClips(
  params: GetClipsRequestQuery = {}
): Promise<GetClipsResponse> {
  const response = await apiClient.get<GetClipsResponse>("/clips/liked", {
    params,
    withCredentials: true,
  });
  return response.data;
}

/**
 * GET /clips/:clipId
 * - 클립 상세 정보
 */
export async function getClipById(clipId: number): Promise<Clip> {
  const response = await apiClient.get<Clip>(`/clips/${clipId}`, {
    withCredentials: true,
  });
  return response.data;
}

/**
 * POST /clips
 * - 클립 등록
 */
export async function createClip(body: CreateClipRequestBody): Promise<Clip> {
  const response = await apiClient.post<Clip>("/clips", body, {
    withCredentials: true,
  });
  return response.data;
}

/**
 * GET /clips/upload/policy
 * - 채널 클립 영상 업로드 정책
 * - 게시판 첨부와 동일한 PRO/일반 용량 정책을 공유한다.
 */
export async function getUploadedClipPolicy(
  channelId: number
): Promise<ClipUploadPolicy> {
  const response = await apiClient.get<ClipUploadPolicy>("/clips/upload/policy", {
    params: { channelId },
    withCredentials: true,
  });
  return response.data;
}

/**
 * POST /clips/upload/video
 * - 클립 원본 영상을 먼저 업로드한다.
 * - 기본 axios 10초 timeout은 대용량 영상 업로드에 맞지 않으므로 이 요청만 timeout을 끈다.
 */
export async function uploadUploadedClipVideo(body: {
  channelId: number;
  video: File;
  onProgress?: (percent: number | undefined) => void;
}): Promise<UploadedClipVideo> {
  const onProgress = body.onProgress;
  const formData = new FormData();
  formData.append("channelId", String(body.channelId));
  formData.append("video", body.video);

  const response = await apiClient.post<UploadedClipVideo>(
    "/clips/upload/video",
    formData,
    {
      headers: { "Content-Type": "multipart/form-data" },
      withCredentials: true,
      timeout: CLIP_MEDIA_UPLOAD_TIMEOUT_MS,
      onUploadProgress: onProgress
        ? (progressEvent) => {
            const total = progressEvent.total;
            if (!total || total <= 0) {
              onProgress(undefined);
              return;
            }
            onProgress(
              Math.min(100, Math.round((progressEvent.loaded / total) * 100)),
            );
          }
        : undefined,
    }
  );
  return response.data;
}

/**
 * POST /clips/upload/thumbnail
 * - 클립 썸네일 이미지를 채널 업로드 정책으로 업로드한다.
 */
export async function uploadUploadedClipThumbnail(body: {
  channelId: number;
  image: File;
}): Promise<UploadedClipThumbnail> {
  const formData = new FormData();
  formData.append("channelId", String(body.channelId));
  formData.append("image", body.image);

  const response = await apiClient.post<UploadedClipThumbnail>(
    "/clips/upload/thumbnail",
    formData,
    {
      headers: { "Content-Type": "multipart/form-data" },
      withCredentials: true,
      timeout: CLIP_MEDIA_UPLOAD_TIMEOUT_MS,
    }
  );
  return response.data;
}

/**
 * POST /clips/upload/complete
 * - 먼저 업로드된 영상 key를 클립 도메인에 등록한다.
 */
export async function createUploadedClip(
  body: CreateUploadedClipRequestBody
): Promise<Clip> {
  const response = await apiClient.post<Clip>("/clips/upload/complete", body, {
    withCredentials: true,
  });
  return response.data;
}

/**
 * POST /clips/url/resolve
 * - 영상 URL에서 메타데이터 조회
 */
export async function resolveClipUrl(
  body: ResolveClipRequest
): Promise<ResolveClipResponse> {
  const response = await apiClient.post<ResolveClipResponse>(
    "/clips/url/resolve",
    body
  );
  return response.data;
}

/**
 * PATCH /clips/:clipId
 * - 클립 수정
 */
export async function updateClip(
  clipId: number,
  body: UpdateClipRequestBody
): Promise<Clip> {
  const response = await apiClient.patch<Clip>(`/clips/${clipId}`, body, {
    withCredentials: true,
  });
  return response.data;
}

/**
 * DELETE /clips/:clipId
 * - 클립 삭제
 */
export async function deleteClip(clipId: number): Promise<Clip> {
  const response = await apiClient.delete<Clip>(`/clips/${clipId}`, {
    withCredentials: true,
  });
  return response.data;
}

/**
 * POST /clips/:clipId/report
 * - 클립 신고 (자동 게시 false positive 등). 익명/로그인 둘 다 허용.
 * - 동일 user 24h 내 중복 신고는 backend 단에서 idempotent.
 */
export async function reportClip(
  clipId: number,
  reason?: string
): Promise<{ reportId: number }> {
  const response = await apiClient.post<{ reportId: number }>(
    `/clips/${clipId}/report`,
    reason ? { reason } : {},
    { withCredentials: true }
  );
  return response.data;
}

/**
 * POST /clips/:clipId/view
 * - 클립 조회수 증가 (IP 기준 5분당 1회 제한)
 * - 로그인 사용자인 경우 viewId 반환 (CF용)
 */
export async function recordClipView(
  clipId: number
): Promise<{ incremented: boolean; viewId?: number }> {
  const response = await apiClient.post<{ incremented: boolean; viewId?: number }>(
    `/clips/${clipId}/view`,
    {},
    { withCredentials: true }
  );
  return response.data;
}

/**
 * PATCH /clips/views/:viewId
 * - 클립 시청 정보 업데이트 (CF 가중치 계산용)
 */
export async function updateClipViewProgress(
  viewId: number,
  data: { watchDuration: number; completed: boolean }
): Promise<{ success: boolean }> {
  const response = await apiClient.patch<{ success: boolean }>(
    `/clips/views/${viewId}`,
    data,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * GET /clips/:clipId/recommendations
 * - 클립 추천 (Content-based + CF)
 */
export async function getClipRecommendations(
  clipId: number,
  options: {
    excludeIds?: string;
    take?: number;
    entropyRatio?: number;
  } = {}
): Promise<Clip[]> {
  const response = await apiClient.get<Clip[]>(
    `/clips/${clipId}/recommendations`,
    {
      params: {
        ...(options.excludeIds && { excludeIds: options.excludeIds }),
        ...(options.take && { take: options.take }),
        ...(options.entropyRatio !== undefined && { entropyRatio: options.entropyRatio }),
      },
      withCredentials: true,
    }
  );
  return response.data;
}

/**
 * DELETE /clips/:clipId/tags/:channelId
 * - 클립 태그 해제 (해당 채널 관리자만, 메인 채널 해제 불가)
 */
export async function removeClipTag(
  clipId: number,
  channelId: number
): Promise<Clip> {
  const response = await apiClient.delete<Clip>(
    `/clips/${clipId}/tags/${channelId}`,
    { withCredentials: true }
  );
  return response.data;
}
