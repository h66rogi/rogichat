'use client';

import { memo, useMemo } from 'react';
import type { ThemeWidgetProps } from '../types';
import {
  buildFontFamilyValue,
  useCommonOptions,
  useTrackTransition,
} from '../shared';
import { hexToRgba, withOpacity, buildBlurFilter } from '../shared/apply-transparency';
import { defaultOptions, type ConcertPosterOptions } from './config';
import type { SongRequest } from '../../types/overlay';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): ConcertPosterOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<ConcertPosterOptions>),
  };
}

interface DisplayTrack {
  id: number | string;
  title: string;
  artist: string;
  requester: string;
  isDonation: boolean;
  isHomework: boolean;
  isRandom: boolean;
}

function buildDisplayTrack(
  now: SongRequest | null | undefined,
): DisplayTrack | null {
  if (!now) return null;
  return {
    id: now.id,
    title: now.song?.title || now.rawTitle || 'UNTITLED',
    artist: now.song?.artist?.name || now.rawArtist || 'UNKNOWN',
    requester: now.requesterNickname || 'ANONYMOUS',
    isDonation: (now.donationAmount ?? 0) > 0,
    isHomework: !!now.isHomework,

    isRandom: !!now.isRandom,
  };
}

function pickNextTitle(queue: SongRequest[] | undefined): string | null {
  if (!queue || queue.length === 0) return null;
  const next = queue[0];
  return next.song?.title || next.rawTitle || null;
}

function buildSoftShadow(offset: number, color: string): string {
  // Single soft drop shadow only — the previous two-layer (hard + blur)
  // shadow stacked into a box-like silhouette behind text. Now just a
  // gentle vertical blur so titles read on top of busy stream backdrops
  // without leaving a phantom rectangle behind them.
  const o = Math.max(1, Math.round(offset));
  return `0 ${o}px ${o * 3 + 2}px ${color}88`;
}

function NowPlaying({
  data,
  options: rawOptions,
  animations,
  fonts,
  reducedMotion,
}: Props) {
  const options = useMemo(() => resolveOptions(rawOptions), [rawOptions]);
  const common = useCommonOptions(rawOptions);
  const headingFont = useMemo(
    () =>
      common.fontFamily ??
      buildFontFamilyValue(
        fonts.roles.heading ?? ['IBM Plex Sans', 'sans-serif'],
      ),
    [common.fontFamily, fonts.roles.heading],
  );

  const channelName = data?.channel?.name?.trim();

  const currentTrack = buildDisplayTrack(data?.nowPlaying ?? null);
  const nextTitle = pickNextTitle(data?.queue);

  const { displayTrack, className: transitionClassName } = useTrackTransition({
    currentTrack,
    trackKey: currentTrack?.id ?? null,
    animation: animations['track.change'],
    reducedMotion,
    themeId: 'concert-poster',
    isSameTrack: (a, b) => a?.id === b?.id,
  });

  const accent = common.accentColor ?? options.accentColor;
  const titleColor = common.textColor ?? options.titleColor;
  const textColor = options.textColor;
  const mutedColor = options.mutedColor;
  const titleShadow = buildSoftShadow(options.shadowOffset, options.shadowColor);

  const containerStyle: React.CSSProperties = useMemo(
    () => ({
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'flex-start',
      fontFamily: headingFont,
      fontWeight: common.fontWeight,
      color: titleColor,
      background: 'transparent',
      pointerEvents: 'none',
      backdropFilter: buildBlurFilter(common.blurIntensity),
      WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
    }),
    [
      headingFont,
      common.fontWeight,
      common.blurIntensity,
      titleColor,
    ],
  );

  if (!displayTrack) {
    return (
      <div style={containerStyle}>
        <div style={{ padding: '0 0 28px 28px', opacity: 0.55 }}>
          <div
            style={{
              fontSize: common.scale(14),
              fontWeight: 700,
              letterSpacing: '0.4em',
              color: accent,
              textTransform: 'uppercase',
            }}
          >
            ♪ STAND BY
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: common.scale(36),
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: titleColor,
              textShadow: titleShadow,
            }}
          >
            노래 신청을 기다리는 중...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div
        className={transitionClassName}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          padding: '0 0 28px 28px',
          maxWidth: '100%',
        }}
      >
        {/* Brand strip — small uppercase MELOMING.COM + channel name. */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            fontSize: common.scale(11),
            fontWeight: 600,
            letterSpacing: '0.32em',
            textTransform: 'uppercase',
            color: textColor,
            opacity: 0.85,
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: accent,
              fontWeight: 700,
            }}
          >
            <span
              aria-hidden
              style={{
                display: 'inline-block',
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: accent,
                boxShadow: `0 0 8px ${accent}`,
              }}
            />
            MELOMING.COM
          </span>
          {channelName ? (
            <>
              <span style={{ opacity: 0.45 }}>/</span>
              <span
                style={{
                  fontWeight: 600,
                  color: textColor,
                  letterSpacing: '0.24em',
                  maxWidth: 420,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {channelName}
              </span>
            </>
          ) : null}
        </div>

        {/* REQUESTED pill — round dot + uppercase requester. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 12px 4px 6px',
              borderRadius: 999,
              background: `linear-gradient(135deg, ${accent}, ${withOpacity(accent, 0.7)})`,
              boxShadow: `0 4px 18px ${hexToRgba(accent, 0.4 * common.borderOpacity)}`,
            }}
          >
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: accent,
                fontSize: common.scale(11),
                fontWeight: 900,
              }}
            >
              ♪
            </div>
            <span
              style={{
                fontSize: common.scale(12),
                fontWeight: 700,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                color: '#fff',
              }}
            >
              REQUESTED · {displayTrack.requester}
            </span>
          </div>
          {displayTrack.isHomework && (
            <span
              style={{
                fontSize: common.scale(10),
                fontWeight: 700,
                letterSpacing: '0.18em',
                color: titleColor,
                background: hexToRgba('#ffffff', 0.12),
                border: `1px solid ${withOpacity(accent, 0.9)}`,
                padding: '3px 8px',
                borderRadius: 999,
                textTransform: 'uppercase',
              }}
            >
              과제곡
            </span>
          )}

          {displayTrack.isRandom && (
            <span
              style={{
                fontSize: common.scale(10),
                fontWeight: 700,
                letterSpacing: '0.18em',
                color: titleColor,
                background: hexToRgba('#ffffff', 0.12),
                border: `1px solid ${withOpacity(accent, 0.9)}`,
                padding: '3px 8px',
                borderRadius: 999,
                textTransform: 'uppercase',
              }}
            >
              과제곡
            </span>
          )}
        </div>

        {/* Title — vertical accent bar + paint-order stroke + soft shadow. */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            position: 'relative',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 14 }}>
            <div
              style={{
                width: 6,
                alignSelf: 'stretch',
                marginTop: 12,
                marginBottom: 16,
                borderRadius: 999,
                background: `linear-gradient(180deg, ${accent} 0%, ${withOpacity(accent, 0.5)} 60%, transparent 100%)`,
                boxShadow: `0 0 14px ${hexToRgba(accent, 0.6)}`,
                flexShrink: 0,
              }}
            />
            <h2
              style={{
                fontSize: `clamp(40px, ${common.scale(4.8)}vw, ${common.scale(80)}px)`,
                fontWeight: 900,
                color: titleColor,
                lineHeight: 1,
                letterSpacing: '-0.035em',
                margin: 0,
                padding: '4px 0',
                textShadow: titleShadow,
                WebkitTextStroke: `1.2px ${withOpacity(accent, 0.65)}`,
                paintOrder: 'stroke fill',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: 1500,
              }}
            >
              {displayTrack.title}
            </h2>
          </div>

          {/* Double-line accent below title — solid bar + bullet + dotted continuation. */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginLeft: 20,
              opacity: 0.95,
            }}
          >
            <div
              style={{
                width: 64,
                height: 4,
                borderRadius: 2,
                background: accent,
                boxShadow: `0 0 12px ${hexToRgba(accent, 0.6)}`,
              }}
            />
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: accent,
                boxShadow: `0 0 8px ${accent}`,
              }}
            />
            <div
              style={{
                flex: '0 0 120px',
                height: 2,
                borderTop: `2px dotted ${withOpacity(accent, 0.6)}`,
              }}
            />
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginTop: 6,
              marginLeft: 20,
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                fontSize: `clamp(16px, ${common.scale(1.8)}vw, ${common.scale(26)}px)`,
                fontWeight: 700,
                color: textColor,
                letterSpacing: '-0.015em',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: 700,
                textShadow: `0 2px 8px ${hexToRgba(options.shadowColor, 0.65)}`,
                WebkitTextStroke: `0.5px ${withOpacity(accent, 0.33)}`,
                paintOrder: 'stroke fill',
              }}
            >
              {displayTrack.artist}
            </span>
            {displayTrack.isDonation && (
              <span
                style={{
                  fontSize: common.scale(11),
                  fontWeight: 700,
                  letterSpacing: '0.18em',
                  color: '#fff',
                  background: accent,
                  padding: '3px 9px',
                  borderRadius: 999,
                  textTransform: 'uppercase',
                  boxShadow: `0 4px 14px ${hexToRgba(accent, 0.4)}`,
                }}
              >
                ♥ 후원
              </span>
            )}
          </div>
        </div>

        {/* NEXT pill — chevron-style inline. */}
        {nextTitle && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '6px 14px 6px 10px',
              borderRadius: 999,
              // Pill is just a thin accent stroke now — no dark fill, so
              // the NEXT chip floats over stream content cleanly without
              // a phantom black plate behind it.
              background: 'transparent',
              border: `1px solid ${withOpacity(accent, 0.55)}`,
              alignSelf: 'flex-start',
              marginTop: 4,
            }}
          >
            <span
              style={{
                fontSize: common.scale(11),
                fontWeight: 800,
                letterSpacing: '0.25em',
                color: accent,
                textTransform: 'uppercase',
              }}
            >
              ›› NEXT
            </span>
            <span
              style={{
                fontSize: common.scale(18),
                fontWeight: 700,
                color: titleColor,
                letterSpacing: '-0.01em',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: 540,
              }}
            >
              {nextTitle}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

NowPlaying.displayName = 'NowPlaying';
export default memo(NowPlaying);
