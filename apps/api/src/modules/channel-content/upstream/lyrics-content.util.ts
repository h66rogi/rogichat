import type { LyricsRetrievalResult } from './global-song/musixmatch/lyrics-retrieval.service.js';

/** 실제 응답으로 노출할 수 있는 가사 콘텐츠가 하나라도 있는지 확인한다. */
export function hasExposableLyrics(result: LyricsRetrievalResult): boolean {
  if (result.status !== 'OK' || !result.lyrics) return false;

  return (
    result.lyrics.body.trim().length > 0 ||
    (result.lyrics.synced.lines?.some((line) => line.text.trim().length > 0) ??
      false) ||
    result.lyrics.richsync !== null
  );
}
