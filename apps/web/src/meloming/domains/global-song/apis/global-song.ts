import { apiClient } from "@/meloming/shared/lib/api-client";
import type {
  GlobalSongByArtistResponse,
  GlobalSongClipQuery,
  GlobalSongClipResponse,
  GlobalSongDetailResponse,
  GlobalSongMyRegistrationsResponse,
} from "@/meloming/domains/global-song/types/global-song";

/**
 * Client-side API for the public GlobalSong endpoints.
 *
 * These are exposed without auth — do NOT send `withCredentials: true` to
 * keep responses cache-friendly. Backend: meloming-back GlobalSongController.
 *
 * Spec: docs/superpowers/specs/2026-04-12-globalsong-detail-design.md §4
 */

/**
 * GET /global-songs/:id
 * Returns detail + cross-channel streamer list. 404 if the song does not exist.
 */
export async function getGlobalSongDetail(
  id: number,
): Promise<GlobalSongDetailResponse> {
  const response = await apiClient.get<GlobalSongDetailResponse>(
    `/global-songs/${id}`,
  );
  return response.data;
}

/**
 * GET /global-songs/:id/clips?sort=popular|recent&cursor=&limit=
 * Paginated clip feed. Cursor resets when `sort` changes.
 */
export async function getGlobalSongClips(
  id: number,
  params: GlobalSongClipQuery = {},
): Promise<GlobalSongClipResponse> {
  const query: Record<string, string | number> = {};
  if (params.sort) query.sort = params.sort;
  if (params.cursor) query.cursor = params.cursor;
  if (params.limit) query.limit = params.limit;

  const response = await apiClient.get<GlobalSongClipResponse>(
    `/global-songs/${id}/clips`,
    { params: query },
  );
  return response.data;
}

/**
 * GET /global-songs/:id/by-artist?limit=
 * Other GlobalSongs of the same artist (channelCount > 0 only), excluding
 * the current song. Public — no auth required.
 */
export async function getGlobalSongsByArtist(
  id: number,
  limit = 10,
): Promise<GlobalSongByArtistResponse> {
  const response = await apiClient.get<GlobalSongByArtistResponse>(
    `/global-songs/${id}/by-artist`,
    { params: { limit } },
  );
  return response.data;
}

/**
 * GET /global-songs/:id/my-registrations
 * Auth-required. Returns the caller's channel ids (any visibility) that
 * already registered this song. Sends credentials so the JWT cookie is
 * attached.
 */
export async function getGlobalSongMyRegistrations(
  id: number,
): Promise<GlobalSongMyRegistrationsResponse> {
  const response = await apiClient.get<GlobalSongMyRegistrationsResponse>(
    `/global-songs/${id}/my-registrations`,
    { withCredentials: true },
  );
  return response.data;
}

/**
 * GET /global-songs/me/registered-ids
 * Auth-required. Bulk variant — returns every distinct GlobalSong id the
 * caller has registered under any of their owned/manager channels.
 */
export async function getMyRegisteredGlobalSongIds(): Promise<{
  registeredGlobalSongIds: number[];
}> {
  const response = await apiClient.get<{ registeredGlobalSongIds: number[] }>(
    `/global-songs/me/registered-ids`,
    { withCredentials: true },
  );
  return response.data;
}
