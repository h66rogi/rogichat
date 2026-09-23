import { apiClient } from "@/meloming/shared/lib/api-client";
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
// List / Search
// ---------------------------------------------------------------------------

export async function getHotPlaylists(
  params: GetPlaylistsQuery = {}
): Promise<GetPlaylistsResponse> {
  const response = await apiClient.get<GetPlaylistsResponse>(
    "/playlists/hot",
    { params, withCredentials: true }
  );
  return response.data;
}

export async function getMyOwnedPlaylists(
  params: GetPlaylistsQuery = {}
): Promise<GetPlaylistsResponse> {
  const response = await apiClient.get<GetPlaylistsResponse>(
    "/playlists/my/owned",
    { params, withCredentials: true }
  );
  return response.data;
}

export async function getMySavedPlaylists(
  params: GetPlaylistsQuery = {}
): Promise<GetPlaylistsResponse> {
  const response = await apiClient.get<GetPlaylistsResponse>(
    "/playlists/my/saved",
    { params, withCredentials: true }
  );
  return response.data;
}

export async function getChannelPlaylists(
  channelId: number,
  params: GetPlaylistsQuery = {}
): Promise<GetPlaylistsResponse> {
  const response = await apiClient.get<GetPlaylistsResponse>(
    `/playlists/channel/${channelId}`,
    { params, withCredentials: true }
  );
  return response.data;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function getPlaylistById(
  playlistId: number
): Promise<Playlist> {
  const response = await apiClient.get<Playlist>(
    `/playlists/${playlistId}`,
    { withCredentials: true }
  );
  return response.data;
}

export async function getPlaylistByShareKey(
  shareKey: string
): Promise<Playlist> {
  const response = await apiClient.get<Playlist>(
    `/playlists/s/${shareKey}`,
    { withCredentials: true }
  );
  return response.data;
}

export async function createPlaylist(
  body: CreatePlaylistBody
): Promise<Playlist> {
  const response = await apiClient.post<Playlist>(
    "/playlists",
    body,
    { withCredentials: true }
  );
  return response.data;
}

export async function updatePlaylist(
  playlistId: number,
  body: UpdatePlaylistBody
): Promise<Playlist> {
  const response = await apiClient.patch<Playlist>(
    `/playlists/${playlistId}`,
    body,
    { withCredentials: true }
  );
  return response.data;
}

export async function deletePlaylist(playlistId: number): Promise<void> {
  await apiClient.delete(`/playlists/${playlistId}`, {
    withCredentials: true,
  });
}

// ---------------------------------------------------------------------------
// Clip management
// ---------------------------------------------------------------------------

export async function addClipToPlaylist(
  playlistId: number,
  body: AddClipToPlaylistBody
): Promise<void> {
  await apiClient.post(`/playlists/${playlistId}/clips`, body, {
    withCredentials: true,
  });
}

export async function removeClipFromPlaylist(
  playlistId: number,
  clipId: number
): Promise<void> {
  await apiClient.delete(`/playlists/${playlistId}/clips/${clipId}`, {
    withCredentials: true,
  });
}

export async function reorderPlaylistClips(
  playlistId: number,
  body: ReorderPlaylistBody
): Promise<void> {
  await apiClient.patch(`/playlists/${playlistId}/clips/reorder`, body, {
    withCredentials: true,
  });
}

// ---------------------------------------------------------------------------
// Clip fetch / view
// ---------------------------------------------------------------------------

export async function getPlaylistClips(
  playlistId: number,
  params: PlaylistClipsQuery = {}
): Promise<GetPlaylistClipsResponse> {
  const response = await apiClient.get<GetPlaylistClipsResponse>(
    `/playlists/${playlistId}/clips`,
    { params, withCredentials: true }
  );
  return response.data;
}

export async function recordPlaylistView(
  playlistId: number
): Promise<{ incremented: boolean }> {
  const response = await apiClient.post<{ incremented: boolean }>(
    `/playlists/${playlistId}/view`,
    {},
    { withCredentials: true }
  );
  return response.data;
}
