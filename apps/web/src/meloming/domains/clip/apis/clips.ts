import { apiClient } from "@/meloming/shared/lib/api-client";
import type { Clip, GetClipsRequestQuery, GetClipsResponse, CreateClipRequestBody, ResolveClipRequest, ResolveClipResponse } from "@/meloming/domains/clip/types/clip";

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

export async function resolveClipUrl(
  body: ResolveClipRequest
): Promise<ResolveClipResponse> {
  const response = await apiClient.post<ResolveClipResponse>(
    "/clips/url/resolve",
    body
  );
  return response.data;
}
