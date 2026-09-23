import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getClipsByChannel, getClipById, createClip } from "@/meloming/domains/clip/apis/clips";
import type { Clip, GetClipsResponse, CreateClipRequestBody } from "@/meloming/domains/clip/types/clip";

export const clipKeys = {
  all: ["clips"] as const,
  channel: (identifier: string | undefined) =>
    [...clipKeys.all, "channel", identifier ?? null] as const,
  song: (identifier: string | undefined, songId: number | undefined) =>
    [...clipKeys.channel(identifier), "song", songId ?? null] as const,
  detail: (clipId: number | undefined) =>
    [...clipKeys.all, "detail", clipId ?? null] as const,
} as const;

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
export function useCreateClip() {
  const queryClient = useQueryClient();
  return useMutation<Clip, Error, CreateClipRequestBody>({
    mutationFn: createClip,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clipKeys.all });
    },
  });
}
