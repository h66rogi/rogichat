'use client';

import { memo, useMemo } from 'react';
import type { ThemeWidgetProps } from '../types';
import {
  buildFontFamilyValue,
  useCommonOptions,
  useQueueAnimation,
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

function getTitle(item: SongRequest): string {
  return item.song?.title || item.rawTitle || 'UNTITLED';
}

function getArtist(item: SongRequest): string {
  return item.song?.artist?.name || item.rawArtist || '';
}

function buildSoftShadow(offset: number, color: string): string {
  // Single soft drop shadow only — no hard box silhouette behind text.
  const o = Math.max(1, Math.round(offset));
  return `0 ${o}px ${o * 3 + 2}px ${color}88`;
}

function Queue({
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
      buildFontFamilyValue(fonts.roles.heading ?? ['IBM Plex Sans', 'sans-serif']),
    [common.fontFamily, fonts.roles.heading],
  );

  const queue = useMemo(() => data?.queue ?? [], [data?.queue]);

  const { animatedItems } = useQueueAnimation<SongRequest>({
    items: queue,
    getItemId: (item) => String(item.id),
    addAnimation: animations['queue.add'],
    removeAnimation: animations['queue.remove'],
    reducedMotion,
  });

  const accent = common.accentColor ?? options.accentColor;
  const titleColor = common.textColor ?? options.titleColor;
  const textColor = options.textColor;
  const mutedColor = options.mutedColor;
  const shadow = buildSoftShadow(options.shadowOffset, options.shadowColor);
  const thinShadow = `1px 1px 0 ${options.shadowColor}`;

  const enterDuration = animations['queue.add']?.enterDuration ?? 260;
  const stagger = animations['queue.add']?.stagger ?? 50;

  const containerStyle: React.CSSProperties = useMemo(
    () => ({
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      padding: 24,
      fontFamily: headingFont,
      fontWeight: common.fontWeight,
      color: titleColor,
      background: 'transparent',
      pointerEvents: 'none',
      backdropFilter: buildBlurFilter(common.blurIntensity),
      WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
    }),
    [headingFont, common.fontWeight, common.blurIntensity, titleColor],
  );

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div
          style={{
            width: 5,
            height: 40,
            borderRadius: 999,
            background: accent,
            boxShadow: `0 0 12px ${hexToRgba(accent, 0.6)}`,
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span
            style={{
              fontSize: common.scale(12),
              fontWeight: 700,
              letterSpacing: '0.32em',
              textTransform: 'uppercase',
              color: accent,
            }}
          >
            ♪ 신청곡
          </span>
          <span
            style={{
              fontSize: common.scale(26),
              fontWeight: 800,
              letterSpacing: '-0.015em',
              color: titleColor,
              textShadow: shadow,
              lineHeight: 1,
              marginTop: 2,
              WebkitTextStroke: `0.6px ${withOpacity(accent, 0.4)}`,
              paintOrder: 'stroke fill',
            }}
          >
            {queue.length}곡 대기
          </span>
        </div>
      </div>

      {queue.length === 0 ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: common.scale(18),
            fontWeight: 900,
            letterSpacing: '0.3em',
            color: mutedColor,
            textShadow: thinShadow,
            textTransform: 'uppercase',
          }}
        >
          NO REQUESTS
        </div>
      ) : (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            {animatedItems.map(({ item, phase, index }) => {
              const isDonation = (item.donationAmount ?? 0) > 0;
              const animationCss =
                phase === 'entering' && !reducedMotion
                  ? `concert-poster-poster-slide-in ${enterDuration}ms cubic-bezier(0.22, 1, 0.36, 1) ${stagger * index}ms 1 both`
                  : phase === 'exiting' && !reducedMotion
                    ? 'concert-poster-poster-fade-out 160ms ease-in 1 both'
                    : undefined;

              return (
                <li
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 14,
                    padding: '8px 14px',
                    borderLeft: `4px solid ${
                      isDonation ? accent : hexToRgba('#ffffff', 0.2)
                    }`,
                    background: isDonation
                      ? hexToRgba(accent, 0.15)
                      : hexToRgba('#000000', 0.25),
                    backdropFilter: 'blur(2px)',
                    animation: animationCss,
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      fontSize: common.scale(24),
                      fontWeight: 900,
                      color: accent,
                      letterSpacing: '-0.05em',
                      textShadow: shadow,
                      minWidth: 36,
                    }}
                  >
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: common.scale(18),
                        fontWeight: 800,
                        color: titleColor,
                        textShadow: shadow,
                        letterSpacing: '-0.01em',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {getTitle(item)}
                    </div>
                    <div
                      style={{
                        marginTop: 1,
                        fontSize: common.scale(13),
                        fontWeight: 600,
                        color: textColor,
                        textShadow: thinShadow,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {getArtist(item)}
                      {item.requesterNickname ? (
                        <span style={{ color: mutedColor }}>
                          {' · '}@{item.requesterNickname}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {isDonation && (
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: common.scale(11),
                        fontWeight: 900,
                        letterSpacing: '0.2em',
                        background: accent,
                        color: titleColor,
                        padding: '3px 8px',
                        borderRadius: 4,
                        textShadow: thinShadow,
                      }}
                    >
                      $
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

Queue.displayName = 'Queue';
export default memo(Queue);
