'use client';

import { memo, type CSSProperties } from 'react';
import type { SongRequest } from '@/domains/overlay/types/overlay';

interface SetlistNowPlayingProps {
  nowPlaying: SongRequest | null | undefined;
  className?: string;
  /** Primary body text color. Falls back to `currentColor`. */
  textColor?: string;
  /** Accent (highlight / label) color. Falls back to `currentColor` with opacity. */
  accentColor?: string;
  /** Font-family string (already with fallbacks). Inherits from parent if omitted. */
  fontFamily?: string;
  /** Root font-size in px. Title/artist/label scale off this. Default 16. */
  baseFontSize?: number;
  /** Multiply all sizes by this (from `options.textSize`). Default 1. */
  textSizeMultiplier?: number;
  /** Whether to render the "NOW PLAYING" label row. Themes that already render
   * their own label should pass `false` to avoid duplication. Default true. */
  showLabel?: boolean;
  /** Whether to render the album-art thumbnail to the left of the text block.
   * Default true. When the track has no `albumArt`, a muted music-note
   * placeholder is rendered in the same slot. */
  showAlbumArt?: boolean;
}

function formatAvailableChannels(nowPlaying: SongRequest): string | null {
  const names = (nowPlaying.availableChannels ?? [])
    .map((channel) => channel.channelName)
    .filter(Boolean);
  if (names.length === 0) return null;
  const visible = names.slice(0, 3);
  const rest = names.length - visible.length;
  return `가능: ${visible.join(', ')}${rest > 0 ? ` 외 ${rest}명` : ''}`;
}

/**
 * Shared "Now Playing" row for the Setlist widget.
 *
 * Hierarchy enforced:
 *   - Title  = largest + heaviest (1.5× base, weight 700)
 *   - Artist = smaller, lighter   (0.85× base, weight 500, opacity 0.85)
 *   - Label  = smallest, subdued  (0.65× base, uppercase letter-spacing,
 *                                  accent/muted color)
 *
 * Themes can still wrap this component in their own container (padding,
 * background, border) and can hide the label (`showLabel={false}`) when they
 * render their own "NOW PLAYING" strip.
 */
function SetlistNowPlaying({
  nowPlaying,
  className,
  textColor,
  accentColor,
  fontFamily,
  baseFontSize = 16,
  textSizeMultiplier = 1,
  showLabel = true,
  showAlbumArt = true,
}: SetlistNowPlayingProps) {
  if (!nowPlaying) return null;

  const title = nowPlaying.song?.title ?? nowPlaying.rawTitle;
  const artist = nowPlaying.song?.artist?.name ?? nowPlaying.rawArtist;
  const albumArt = nowPlaying.song?.albumArt;

  const base = Math.round(baseFontSize * textSizeMultiplier);
  const thumbSize = Math.round(base * 2.6);

  const labelStyle: CSSProperties = {
    fontSize: Math.max(10, Math.round(base * 0.65)),
    fontWeight: 600,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: accentColor ?? 'currentColor',
    opacity: accentColor ? 1 : 0.6,
    marginBottom: 4,
    fontFamily,
  };

  // 2-line clamp: `textOverflow: ellipsis` alone doesn't work without
  // `whiteSpace: nowrap`, and nowrap cuts most Korean titles too early at
  // high `textSize` multipliers. `-webkit-line-clamp` bounds height at 2
  // lines so Now Playing block doesn't steal the body setlist's space.
  const titleStyle: CSSProperties = {
    fontSize: Math.round(base * 1.5),
    fontWeight: 700,
    lineHeight: 1.15,
    color: textColor ?? 'currentColor',
    fontFamily,
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
    overflow: 'hidden',
    wordBreak: 'break-word',
  };

  const artistStyle: CSSProperties = {
    fontSize: Math.round(base * 0.85),
    fontWeight: 500,
    lineHeight: 1.3,
    marginTop: 2,
    color: textColor ?? 'currentColor',
    opacity: 0.85,
    fontFamily,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };
  const availableChannelsStyle: CSSProperties = {
    ...artistStyle,
    fontSize: Math.round(base * 0.72),
    opacity: 0.68,
    marginTop: 1,
  };

  const thumbStyle: CSSProperties = {
    width: thumbSize,
    height: thumbSize,
    flexShrink: 0,
    borderRadius: Math.max(2, Math.round(thumbSize * 0.08)),
    overflow: 'hidden',
    background: 'rgba(127, 127, 127, 0.18)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: accentColor ?? textColor ?? 'currentColor',
  };

  const thumbImgStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  };

  const containerStyle: CSSProperties = {
    fontFamily,
    display: 'flex',
    alignItems: 'center',
    gap: Math.round(base * 0.6),
  };

  return (
    <div className={className} style={containerStyle}>
      {showAlbumArt && (
        <div style={thumbStyle} aria-hidden="true">
          {albumArt ? (
            <img src={albumArt} alt="" style={thumbImgStyle} />
          ) : (
            <svg
              width="55%"
              height="55%"
              viewBox="0 0 24 24"
              fill="currentColor"
              style={{ opacity: 0.45 }}
            >
              <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3z" />
            </svg>
          )}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        {showLabel && <div style={labelStyle}>NOW PLAYING</div>}
        <div style={titleStyle}>{title}</div>
        {artist && <div style={artistStyle}>{artist}</div>}
        {formatAvailableChannels(nowPlaying) && (
          <div style={availableChannelsStyle}>
            {formatAvailableChannels(nowPlaying)}
          </div>
        )}
      </div>
    </div>
  );
}
SetlistNowPlaying.displayName = 'SetlistNowPlaying';
const MemoizedSetlistNowPlaying = memo(SetlistNowPlaying);
export { MemoizedSetlistNowPlaying as SetlistNowPlaying };
