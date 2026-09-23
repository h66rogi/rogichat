/**
 * LRC subtitle parser for Musixmatch `track.subtitle.get` outputs.
 *
 * Input format (mxm `subtitle_format = 'lrc'`):
 *   [mm:ss.xx]text          single timestamp
 *   [mm:ss.xxx]text         millisecond precision
 *   [mm:ss.xx][mm:ss.xx]t   multiple timestamps share the same line
 *   [00:00.00]              empty timestamp marker (skipped)
 *   line without timestamp  (skipped)
 *
 * Output: lines sorted by `startMs` ascending. Each timestamp on a multi-stamp
 * line emits its own entry. `endMs` is intentionally NOT computed here — the
 * caller can derive it as `lines[i+1].startMs` (last line runs to end of track).
 */

export interface LrcLine {
  startMs: number;
  text: string;
}

const TIMESTAMP_RE = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

export function parseLrc(body: string | null | undefined): LrcLine[] {
  if (!body) return [];

  const lines: LrcLine[] = [];

  for (const raw of body.split(/\r?\n/)) {
    const matches = Array.from(raw.matchAll(TIMESTAMP_RE));
    if (matches.length === 0) continue;

    const stamps: number[] = [];
    for (const m of matches) {
      const minutes = Number.parseInt(m[1], 10);
      const seconds = Number.parseInt(m[2], 10);
      const fracRaw = m[3] ?? '0';
      const ms = fracToMs(fracRaw);

      if (
        Number.isFinite(minutes) &&
        Number.isFinite(seconds) &&
        seconds < 60 &&
        Number.isFinite(ms)
      ) {
        stamps.push(minutes * 60_000 + seconds * 1_000 + ms);
      }
    }
    if (stamps.length === 0) continue;

    const last = matches[matches.length - 1];
    const tail = (last.index ?? 0) + last[0].length;
    const text = raw.slice(tail).trim();

    for (const startMs of stamps) {
      lines.push({ startMs, text });
    }
  }

  lines.sort((a, b) => a.startMs - b.startMs);
  return lines;
}

function fracToMs(frac: string): number {
  if (!frac) return 0;
  const padded =
    frac.length === 1
      ? frac + '00'
      : frac.length === 2
        ? frac + '0'
        : frac.slice(0, 3);
  const n = Number.parseInt(padded, 10);
  return Number.isFinite(n) ? n : 0;
}
