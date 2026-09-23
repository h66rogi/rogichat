import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getClipsByChannel,
  getHotClips,
  getLikedClips,
  getClipById,
  getClipRecommendations,
  createClip,
  createUploadedClip,
  getUploadedClipPolicy,
  uploadUploadedClipThumbnail,
  uploadUploadedClipVideo,
  updateClip,
  deleteClip,
  removeClipTag,
  getAutoClipPlayUrl,
  getClipDownloadUrl,
} from "@/meloming/domains/clip/apis/clips";
import { recentClipsStorage } from "@/meloming/domains/clip/utils/recent-clips-storage";
import { toast } from "sonner";
import type {
  Clip,
  GetClipsRequestQuery,
  GetClipsResponse,
  CreateClipRequestBody,
  CreateUploadedClipRequestBody,
  UpdateClipRequestBody,
  GetAutoClipPlayUrlResponse,
  ClipUploadPolicy,
  UploadedClipVideo,
  UploadedClipThumbnail,
} from "@/meloming/domains/clip/types/clip";

// ---------------------------------------------------------------------------
// Query Keys
// ---------------------------------------------------------------------------

export const clipKeys = {
  all: ["clips"] as const,
  channel: (identifier: string | undefined) =>
    [...clipKeys.all, "channel", identifier ?? null] as const,
  infiniteChannel: (identifier: string | undefined, take?: number) =>
    [...clipKeys.channel(identifier), "infinite", take ?? 20] as const,
  song: (identifier: string | undefined, songId: number | undefined) =>
    [...clipKeys.channel(identifier), "song", songId ?? null] as const,
  hot: () => [...clipKeys.all, "hot"] as const,
  hotWithParams: (params: GetClipsRequestQuery) =>
    [...clipKeys.hot(), params] as const,
  infiniteHot: (params: Omit<GetClipsRequestQuery, "cursorId">) =>
    [...clipKeys.hot(), "infinite", params] as const,
  liked: () => [...clipKeys.all, "liked"] as const,
  likedWithParams: (params: GetClipsRequestQuery) =>
    [...clipKeys.liked(), params] as const,
  detail: (clipId: number | undefined) =>
    [...clipKeys.all, "detail", clipId ?? null] as const,
  recommendations: (clipId: number | undefined) =>
    [...clipKeys.all, "recommendations", clipId ?? null] as const,
  playUrl: (clipId: number | undefined) =>
    [...clipKeys.all, "play-url", clipId ?? null] as const,
  uploadPolicy: (channelId: number | undefined) =>
    [...clipKeys.all, "upload-policy", channelId ?? null] as const,
} as const;

/**
 * self-hosted DIRECT_FILE 클립 (mediaType=DIRECT_FILE + selfHosted=true) 의 presigned URL 발급.
 * EMBED 클립은 호출 X — embed URL 직접 사용.
 *
 * presigned URL 만료보다 짧은 staleTime (5분) 으로 stale 시 자동 refetch.
 */
export function useAutoClipPlayUrl(
  clipId: number | undefined,
  options?: { enabled?: boolean }
) {
  return useQuery<GetAutoClipPlayUrlResponse, Error>({
    queryKey: clipKeys.playUrl(clipId),
    queryFn: () => getAutoClipPlayUrl(clipId as number),
    enabled: Boolean(clipId) && (options?.enabled ?? true),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useUploadedClipPolicy(
  channelId: number | undefined,
  options?: { enabled?: boolean; staleTime?: number; gcTime?: number }
) {
  return useQuery<ClipUploadPolicy, Error>({
    queryKey: clipKeys.uploadPolicy(channelId),
    queryFn: () => getUploadedClipPolicy(channelId as number),
    enabled: Boolean(channelId) && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 5 * 60 * 1000,
    gcTime: options?.gcTime ?? 10 * 60 * 1000,
  });
}

/**
 * selfHosted DIRECT_FILE 클립 mp4 다운로드.
 * presigned URL(Content-Disposition: attachment) 발급 후 anchor click 으로 브라우저 저장 트리거.
 * 채널 관리자만 호출 (백엔드 권한 검증) — 호출부에서 selfHosted 여부로 버튼 노출 분기.
 */
export function useDownloadClip() {
  return useMutation<GetAutoClipPlayUrlResponse, Error, number>({
    mutationFn: getClipDownloadUrl,
    onSuccess: (data) => {
      // cross-origin presigned 라 a[download] 속성은 무시되지만, S3 응답의
      // Content-Disposition: attachment 헤더가 브라우저 저장 동작을 강제한다.
      const a = document.createElement("a");
      a.href = data.url;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    },
    onError: () => {
      toast.error("다운로드 링크 발급에 실패했습니다.");
    },
  });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * 채널별 클립 목록 (무한 스크롤)
 */
export function useInfiniteChannelClips(
  identifier: string | undefined,
  params: Omit<GetClipsRequestQuery, "cursorId"> = {},
  options?: { enabled?: boolean; staleTime?: number; gcTime?: number }
) {
  return useInfiniteQuery<GetClipsResponse, Error>({
    queryKey: clipKeys.infiniteChannel(identifier, params.take),
    queryFn: ({ pageParam }) =>
      getClipsByChannel(identifier as string, {
        ...params,
        cursorId: pageParam as number | undefined,
      }),
    enabled: Boolean(identifier) && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 5 * 60 * 1000,
    gcTime: options?.gcTime ?? 10 * 60 * 1000,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined as number | undefined,
  });
}

/**
 * 핫클립 목록 (무한 스크롤)
 */
export function useInfiniteHotClips(
  params: Omit<GetClipsRequestQuery, "cursorId"> = {},
  options?: { enabled?: boolean; staleTime?: number; gcTime?: number }
) {
  return useInfiniteQuery<GetClipsResponse, Error>({
    queryKey: clipKeys.infiniteHot(params),
    queryFn: ({ pageParam }) =>
      getHotClips({
        ...params,
        cursorId: pageParam as number | undefined,
      }),
    enabled: options?.enabled ?? true,
    staleTime: options?.staleTime ?? 5 * 60 * 1000,
    gcTime: options?.gcTime ?? 10 * 60 * 1000,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined as number | undefined,
  });
}

/**
 * 핫클립 목록 (일반 쿼리 - 페이지네이션용)
 */
export function useHotClips(
  params: GetClipsRequestQuery = {},
  options?: { enabled?: boolean; staleTime?: number; gcTime?: number }
) {
  return useQuery<GetClipsResponse, Error>({
    queryKey: clipKeys.hotWithParams(params),
    queryFn: () => getHotClips(params),
    enabled: options?.enabled ?? true,
    staleTime: options?.staleTime ?? 5 * 60 * 1000,
    gcTime: options?.gcTime ?? 10 * 60 * 1000,
  });
}

/**
 * 좋아요한 클립 목록 (일반 쿼리 - 페이지네이션용)
 */
export function useLikedClips(
  params: GetClipsRequestQuery = {},
  options?: { enabled?: boolean; staleTime?: number; gcTime?: number }
) {
  return useQuery<GetClipsResponse, Error>({
    queryKey: clipKeys.likedWithParams(params),
    queryFn: () => getLikedClips(params),
    enabled: options?.enabled ?? true,
    staleTime: options?.staleTime ?? 5 * 60 * 1000,
    gcTime: options?.gcTime ?? 10 * 60 * 1000,
  });
}

/**
 * 클립 상세
 */
export function useClip(
  clipId: number | undefined,
  options?: { enabled?: boolean; staleTime?: number; gcTime?: number }
) {
  return useQuery<Clip, Error>({
    queryKey: clipKeys.detail(clipId),
    queryFn: () => getClipById(clipId as number),
    enabled: Boolean(clipId) && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 5 * 60 * 1000,
    gcTime: options?.gcTime ?? 10 * 60 * 1000,
  });
}

/**
 * 클립 추천 (Content-based + CF)
 * - 자동으로 세션 스토리지의 최근 본 클립을 제외
 */
export function useClipRecommendations(
  clipId: number | undefined,
  options?: {
    enabled?: boolean;
    staleTime?: number;
    gcTime?: number;
    take?: number;
    entropyRatio?: number;
  }
) {
  return useQuery<Clip[], Error>({
    queryKey: clipKeys.recommendations(clipId),
    queryFn: () =>
      getClipRecommendations(clipId as number, {
        excludeIds: recentClipsStorage.getExcludeIdsString(),
        take: options?.take ?? 10,
        entropyRatio: options?.entropyRatio ?? 0.2,
      }),
    enabled: Boolean(clipId) && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 5 * 60 * 1000,
    gcTime: options?.gcTime ?? 10 * 60 * 1000,
  });
}

/**
 * 노래별 클립 목록
 */
export function useClipsBySong(
  identifier: string | undefined,
  songId: number | undefined,
  options?: { enabled?: boolean; staleTime?: number; gcTime?: number }
) {
  return useQuery<GetClipsResponse, Error>({
    queryKey: clipKeys.song(identifier, songId),
    queryFn: () =>
      getClipsByChannel(identifier as string, { songId, take: 10 }),
    enabled:
      Boolean(identifier) && Boolean(songId) && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 5 * 60 * 1000,
    gcTime: options?.gcTime ?? 10 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * 클립 등록
 */
export function useCreateClip(channelIdentifier?: string) {
  const queryClient = useQueryClient();
  return useMutation<Clip, Error, CreateClipRequestBody>({
    mutationFn: createClip,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clipKeys.all });
      if (channelIdentifier) {
        queryClient.invalidateQueries({
          queryKey: clipKeys.infiniteChannel(channelIdentifier),
        });
      }
    },
  });
}

export function useCreateUploadedClip(channelIdentifier?: string) {
  const queryClient = useQueryClient();

  return useMutation<Clip, Error, CreateUploadedClipRequestBody>({
    mutationFn: createUploadedClip,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clipKeys.channel(channelIdentifier) });
      queryClient.invalidateQueries({ queryKey: clipKeys.hot() });
    },
  });
}

export function useUploadUploadedClipVideo() {
  return useMutation<
    UploadedClipVideo,
    Error,
    {
      channelId: number;
      video: File;
      onProgress?: (percent: number | undefined) => void;
    }
  >({
    mutationFn: uploadUploadedClipVideo,
  });
}

export function useUploadUploadedClipThumbnail() {
  return useMutation<
    UploadedClipThumbnail,
    Error,
    {
      channelId: number;
      image: File;
    }
  >({
    mutationFn: uploadUploadedClipThumbnail,
  });
}

/**
 * 클립 수정
 */
export function useUpdateClip(clipId: number) {
  const queryClient = useQueryClient();
  return useMutation<Clip, Error, UpdateClipRequestBody>({
    mutationFn: (body) => updateClip(clipId, body),
    onSuccess: (updatedClip) => {
      // 클립 상세 캐시 업데이트
      queryClient.setQueryData(clipKeys.detail(clipId), updatedClip);
      // 목록 캐시 무효화
      queryClient.invalidateQueries({ queryKey: clipKeys.all });
    },
  });
}

/**
 * 클립 삭제
 */
export function useDeleteClip() {
  const queryClient = useQueryClient();
  return useMutation<Clip, Error, number>({
    mutationFn: deleteClip,
    onSuccess: (_, clipId) => {
      // 클립 상세 캐시 제거
      queryClient.removeQueries({ queryKey: clipKeys.detail(clipId) });
      // 목록 캐시 무효화
      queryClient.invalidateQueries({ queryKey: clipKeys.all });
    },
  });
}

/**
 * 클립 태그 해제 (해당 채널 관리자만)
 */
export function useRemoveClipTag(clipId: number) {
  const queryClient = useQueryClient();
  return useMutation<Clip, Error, number>({
    mutationFn: (channelId) => removeClipTag(clipId, channelId),
    onSuccess: (updatedClip) => {
      // 클립 상세 캐시 업데이트
      queryClient.setQueryData(clipKeys.detail(clipId), updatedClip);
      // 목록 캐시 무효화
      queryClient.invalidateQueries({ queryKey: clipKeys.all });
    },
  });
}
