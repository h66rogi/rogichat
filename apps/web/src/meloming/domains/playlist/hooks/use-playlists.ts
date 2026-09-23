import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  getHotPlaylists,
  getMyOwnedPlaylists,
  getMySavedPlaylists,
  getChannelPlaylists,
  getPlaylistById,
  getPlaylistByShareKey,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  addClipToPlaylist,
  removeClipFromPlaylist,
  reorderPlaylistClips,
  getPlaylistClips,
} from "@/meloming/domains/playlist/apis/playlists";
import type {
  Playlist,
  GetPlaylistsQuery,
  GetPlaylistsResponse,
  CreatePlaylistBody,
  UpdatePlaylistBody,
  AddClipToPlaylistBody,
  ReorderPlaylistBody,
  GetPlaylistClipsResponse,
  PlaylistClipsQuery,
} from "@/meloming/domains/playlist/types/playlist";

// ---------------------------------------------------------------------------
// Query Keys
// ---------------------------------------------------------------------------

export const playlistKeys = {
  all: ["playlists"] as const,
  hot: () => [...playlistKeys.all, "hot"] as const,
  hotWithParams: (params: GetPlaylistsQuery) =>
    [...playlistKeys.hot(), params] as const,
  myOwned: () => [...playlistKeys.all, "my", "owned"] as const,
  myOwnedWithParams: (params: GetPlaylistsQuery) =>
    [...playlistKeys.myOwned(), params] as const,
  mySaved: () => [...playlistKeys.all, "my", "saved"] as const,
  mySavedWithParams: (params: GetPlaylistsQuery) =>
    [...playlistKeys.mySaved(), params] as const,
  channel: (channelId: number | undefined) =>
    [...playlistKeys.all, "channel", channelId ?? null] as const,
  channelWithParams: (channelId: number | undefined, params: GetPlaylistsQuery) =>
    [...playlistKeys.channel(channelId), params] as const,
  detail: (playlistId: number | undefined) =>
    [...playlistKeys.all, "detail", playlistId ?? null] as const,
  shareKey: (shareKey: string | undefined) =>
    [...playlistKeys.all, "shareKey", shareKey ?? null] as const,
  clips: (playlistId: number | undefined, params?: PlaylistClipsQuery) =>
    [...playlistKeys.all, "clips", playlistId ?? null, params ?? null] as const,
} as const;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useHotPlaylists(
  params: GetPlaylistsQuery = {},
  options?: { enabled?: boolean }
) {
  return useQuery<GetPlaylistsResponse, Error>({
    queryKey: playlistKeys.hotWithParams(params),
    queryFn: () => getHotPlaylists(params),
    enabled: options?.enabled ?? true,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useMyOwnedPlaylists(
  params: GetPlaylistsQuery = {},
  options?: { enabled?: boolean }
) {
  return useQuery<GetPlaylistsResponse, Error>({
    queryKey: playlistKeys.myOwnedWithParams(params),
    queryFn: () => getMyOwnedPlaylists(params),
    enabled: options?.enabled ?? true,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}

export function useMySavedPlaylists(
  params: GetPlaylistsQuery = {},
  options?: { enabled?: boolean }
) {
  return useQuery<GetPlaylistsResponse, Error>({
    queryKey: playlistKeys.mySavedWithParams(params),
    queryFn: () => getMySavedPlaylists(params),
    enabled: options?.enabled ?? true,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}

export function useChannelPlaylists(
  channelId: number | undefined,
  params: GetPlaylistsQuery = {},
  options?: { enabled?: boolean }
) {
  return useQuery<GetPlaylistsResponse, Error>({
    queryKey: playlistKeys.channelWithParams(channelId, params),
    queryFn: () => getChannelPlaylists(channelId!, params),
    enabled: Boolean(channelId) && (options?.enabled ?? true),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function usePlaylist(
  playlistId: number | undefined,
  options?: { enabled?: boolean }
) {
  return useQuery<Playlist, Error>({
    queryKey: playlistKeys.detail(playlistId),
    queryFn: () => getPlaylistById(playlistId!),
    enabled: Boolean(playlistId) && (options?.enabled ?? true),
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}

export function usePlaylistByShareKey(
  shareKey: string | undefined,
  options?: { enabled?: boolean }
) {
  return useQuery<Playlist, Error>({
    queryKey: playlistKeys.shareKey(shareKey),
    queryFn: () => getPlaylistByShareKey(shareKey!),
    enabled: Boolean(shareKey) && (options?.enabled ?? true),
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}

export function usePlaylistClips(
  playlistId: number | undefined,
  params: PlaylistClipsQuery = {},
  options?: { enabled?: boolean }
) {
  return useQuery<GetPlaylistClipsResponse, Error>({
    queryKey: playlistKeys.clips(playlistId, params),
    queryFn: () => getPlaylistClips(playlistId!, params),
    enabled: Boolean(playlistId) && (options?.enabled ?? true),
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useCreatePlaylist() {
  const queryClient = useQueryClient();
  return useMutation<Playlist, Error, CreatePlaylistBody>({
    mutationFn: createPlaylist,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: playlistKeys.all });
    },
  });
}

export function useUpdatePlaylist(playlistId: number) {
  const queryClient = useQueryClient();
  return useMutation<Playlist, Error, UpdatePlaylistBody>({
    mutationFn: (body) => updatePlaylist(playlistId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: playlistKeys.detail(playlistId) });
      queryClient.invalidateQueries({ queryKey: playlistKeys.all });
    },
  });
}

export function useDeletePlaylist() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, number>({
    mutationFn: deletePlaylist,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: playlistKeys.all });
    },
  });
}

export function useAddClipToPlaylist(playlistId: number) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, AddClipToPlaylistBody>({
    mutationFn: (body) => addClipToPlaylist(playlistId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: playlistKeys.detail(playlistId) });
      queryClient.invalidateQueries({ queryKey: playlistKeys.all });
    },
  });
}

export function useRemoveClipFromPlaylist(playlistId: number) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, number>({
    mutationFn: (clipId) => removeClipFromPlaylist(playlistId, clipId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: playlistKeys.detail(playlistId) });
      queryClient.invalidateQueries({ queryKey: playlistKeys.all });
    },
  });
}

export function useReorderPlaylistClips(playlistId: number) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, ReorderPlaylistBody>({
    mutationFn: (body) => reorderPlaylistClips(playlistId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: playlistKeys.detail(playlistId) });
      // clips 쿼리도 invalidate — 순서 + clipsVersion 동기화 필수.
      // 안 하면 다음 reorder 시 stale clipsVersion으로 409 반복 발생.
      queryClient.invalidateQueries({ queryKey: playlistKeys.all });
    },
  });
}
