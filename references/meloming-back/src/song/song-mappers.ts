/**
 * Permission-aware response shaper for Song rows.
 *
 * Shared between `SongQueryService` (list/search endpoints) and `SongService`
 * (single-song endpoints — `getSongByChannelId` / `getPublicSongById`).
 *
 * Policy
 * ------
 *
 * - `lyricsText` 정책은 list (strip 항상) vs single-song (`exposeLyricsToManager`
 *   true 시 매니저 retain) 분기.
 */
export function mapSongForViewer<T extends Record<string, any>>(
  song: T,
  viewer: { isManager: boolean },
  options: { exposeLyricsToManager?: boolean } = {},
): Record<string, any> {
  const { lyricsText, mrVideoKey: _mrVideoKey, ...rest } = song as any;
  const exposeLyrics = options.exposeLyricsToManager === true;

  if (viewer.isManager) {
    return {
      ...rest,
      ...(exposeLyrics && lyricsText !== undefined ? { lyricsText } : {}),
    };
  }
  // Non-managers: lyricsText is stripped.
  return rest;
}
