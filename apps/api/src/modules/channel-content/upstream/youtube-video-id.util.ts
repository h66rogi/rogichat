const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * YouTube URL/ID에서 11자 video id만 추출. 모든 querystring/path variant
 * (`?t=`, `&list=`, `&si=`, `youtu.be/`, `embed/`, `shorts/`,
 * `music.youtube.com/watch?v=`)를 정규화.
 *
 * Distinct 카운트에서 사용하는 video ID 정규화.
 */
export function extractYoutubeVideoId(
  input: string | null | undefined,
): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (VIDEO_ID_RE.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');

  if (host === 'youtu.be') {
    const id = url.pathname.replace(/^\/+/, '').split('/')[0];
    return id && VIDEO_ID_RE.test(id) ? id : null;
  }

  if (host.endsWith('youtube.com') || host === 'm.youtube.com') {
    const v = url.searchParams.get('v');
    if (v && VIDEO_ID_RE.test(v)) return v;

    const seg = url.pathname.split('/').filter(Boolean);
    if (
      seg.length >= 2 &&
      (seg[0] === 'embed' || seg[0] === 'shorts' || seg[0] === 'live')
    ) {
      return seg[1] && VIDEO_ID_RE.test(seg[1]) ? seg[1] : null;
    }
  }

  return null;
}
