'use client';

import { useMemo, memo} from 'react';
import type { ThemeWidgetProps } from '../types';
import { buildFontFamilyValue, useCommonOptions, useQueueAnimation } from '../shared';
import { buildBlurFilter } from '../shared/apply-transparency';
import { defaultOptions, type ThreeDDepthOptions } from './config';
import type { SongRequest } from '../../types/overlay';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): ThreeDDepthOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<ThreeDDepthOptions>),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function hexToRgbTriplet(hex: string, fallback = '30, 41, 59'): string {
  const match = hex.trim().match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!match) return fallback;
  const r = parseInt(match[1], 16);
  const g = parseInt(match[2], 16);
  const b = parseInt(match[3], 16);
  return `${r}, ${g}, ${b}`;
}

function lighten(rgbTriplet: string, amount: number): string {
  const [r, g, b] = rgbTriplet.split(',').map((p) => parseInt(p.trim(), 10));
  const lift = (v: number) => Math.round(v + (255 - v) * amount);
  return `${lift(r)}, ${lift(g)}, ${lift(b)}`;
}

function getTitle(item: SongRequest): string {
  return item.song?.title || item.rawTitle || 'Unknown';
}

function getArtist(item: SongRequest): string {
  return item.song?.artist?.name || item.rawArtist || '';
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
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.heading ?? ['Inter', 'sans-serif']),
    [common.fontFamily, fonts.roles.heading],
  );
  const bodyFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['Poppins', 'sans-serif']),
    [common.fontFamily, fonts.roles.body],
  );
  const accentFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.accent ?? ['Outfit', 'sans-serif']),
    [common.fontFamily, fonts.roles.accent],
  );

  const queue = useMemo(() => data?.queue ?? [], [data?.queue]);

  const { animatedItems } = useQueueAnimation<SongRequest>({
    items: queue,
    getItemId: (item) => String(item.id),
    addAnimation: animations['queue.add'],
    removeAnimation: animations['queue.remove'],
    reducedMotion,
  });

  const perspective = clamp(options.perspective, 400, 1200);
  const rotateY = clamp(options.rotateY, -20, 20);
  const rotateX = clamp(options.rotateX, -20, 20);
  const shadowDepth = clamp(options.shadowDepth, 8, 40);

  const baseColor = options.baseColor || '#1e293b';
  const accentColor = common.accentColor ?? options.accentColor ?? '#6366f1';
  const highlightColor = options.highlightColor || '#a78bfa';
  const textColor = common.textColor ?? options.textColor ?? '#ffffff';

  const baseRgb = hexToRgbTriplet(baseColor, '30, 41, 59');
  const accentRgb = hexToRgbTriplet(accentColor, '99, 102, 241');
  const baseLighter = lighten(baseRgb, 0.14);

  const shadowScale = shadowDepth / 20;
  const cardShadow = [
    `${Math.round(25 * shadowScale)}px ${Math.round(25 * shadowScale)}px ${Math.round(60 * shadowScale)}px rgba(0, 0, 0, 0.5)`,
    `-${Math.round(4 * shadowScale)}px -${Math.round(4 * shadowScale)}px ${Math.round(15 * shadowScale)}px rgba(255, 255, 255, 0.02)`,
    `0 0 ${Math.round(28 * shadowScale)}px rgba(${accentRgb}, 0.08)`,
  ].join(', ');

  const enterDuration = animations['queue.add']?.enterDuration ?? 500;
  const stagger = animations['queue.add']?.stagger ?? 80;
  const easing = animations['queue.add']?.easing ?? 'cubic-bezier(0.22, 1, 0.36, 1)';

  const containerStyle: React.CSSProperties = useMemo(() => ({
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: bodyFont,
    fontWeight: common.fontWeight,
    color: textColor,
    background: 'transparent',
    perspective: `${perspective}px`,
    perspectiveOrigin: '50% 40%',
    position: 'relative',
    overflow: 'visible',
    padding: 16,
  }), [bodyFont, common.textSizeMultiplier, common.fontWeight, textColor, perspective]);

  const frameStyle: React.CSSProperties = useMemo(() => {
    const rgb = hexToRgbTriplet(baseColor, '30, 41, 59');
    const lighter = lighten(rgb, 0.14);
    return {
      position: 'relative',
      flex: 1,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      padding: '20px 22px',
      borderRadius: 20,
      background: `linear-gradient(135deg, rgba(${lighter}, ${common.backgroundOpacity}) 0%, rgba(${rgb}, ${common.backgroundOpacity}) 100%)`,
      border: `1px solid rgba(255, 255, 255, ${0.05 * common.borderOpacity})`,
      transform: `rotateY(${rotateY}deg) rotateX(${rotateX}deg)`,
      transformStyle: 'preserve-3d',
      transformOrigin: 'center center',
      willChange: 'transform',
      backdropFilter: buildBlurFilter(common.blurIntensity),
      WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
    };
  }, [baseColor, rotateY, rotateX, common.backgroundOpacity, common.borderOpacity, common.blurIntensity]);

  const headerStyle: React.CSSProperties = useMemo(() => ({
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  }), []);

  const isEmpty = queue.length === 0;
  const totalQueue = (data?.queue ?? []).length;

  return (
    <div style={containerStyle}>
      <div style={frameStyle}>
        <div style={headerStyle}>
          <div
            style={{
              fontFamily: headingFont,
              fontSize: common.scale(16),
              fontWeight: 700,
              color: textColor,
              letterSpacing: 0.5,
              textShadow: '0 2px 6px rgba(0, 0, 0, 0.4)',
            }}
          >
            Up Next
          </div>
          <span
            style={{
              marginLeft: 'auto',
              fontFamily: accentFont,
              fontSize: common.scale(12),
              letterSpacing: 1,
              padding: '3px 9px',
              borderRadius: 999,
              background: `linear-gradient(135deg, ${accentColor}, ${highlightColor})`,
              color: '#ffffff',
              boxShadow: `0 4px 14px rgba(${accentRgb}, 0.4)`,
            }}
          >
            {totalQueue.toString().padStart(2, '0')} queued
          </span>
        </div>

        {isEmpty ? (
          <div
            style={{
              padding: '32px 12px',
              textAlign: 'center',
              fontFamily: bodyFont,
              fontSize: common.scale(13),
              color: textColor,
              opacity: 0.5,
              border: `1px dashed rgba(255, 255, 255, 0.1)`,
              borderRadius: 14,
              backgroundColor: 'rgba(0, 0, 0, 0.18)',
              boxShadow: 'inset 0 2px 8px rgba(0, 0, 0, 0.3)',
            }}
          >
            Queue is empty
          </div>
        ) : (
          <ul data-overlay-scroll
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
            }}
          >
            {animatedItems.map(({ item, phase, index }) => {
              const isDonation = (item.donationAmount ?? 0) > 0;
              const isHomework = !!item.isHomework;

              const isRandom = !!item.isRandom;

              const animationCss =
                phase === 'entering' && !reducedMotion
                  ? `depth3d-depth-pop ${enterDuration}ms ${easing} ${stagger * index}ms 1 both`
                  : undefined;

              // Static layered offset applied after animation settles. Each
              // item scales slightly to give the list a layered "stack of
              // cards" look rather than a flat list. (Previously used translateZ
              // with preserve-3d on every <li>, but that caused expensive
              // per-item 3D paint; we now keep only a 2D scale.)
              const recedeScale = 1 - index * 0.01;

              return (
                <li
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: 11,
                    borderRadius: 14,
                    background: isDonation
                      ? `linear-gradient(135deg, rgba(${accentRgb}, 0.32) 0%, rgba(${accentRgb}, 0.16) 100%)`
                      : `linear-gradient(135deg, rgba(${baseLighter}, 0.55) 0%, rgba(${baseRgb}, 0.55) 100%)`,
                    border: `1px solid rgba(${isDonation ? accentRgb : '255, 255, 255'}, ${isDonation ? 0.45 : 0.06})`,
                    boxShadow: isDonation
                      ? `8px 10px 22px rgba(0, 0, 0, 0.45), 0 0 22px rgba(${accentRgb}, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.08)`
                      : `6px 8px 18px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.04)`,
                    transform: animationCss ? undefined : `scale(${recedeScale})`,
                    transformOrigin: 'center center',
                    animation: animationCss,
                  }}
                >
                  {/* Index badge */}
                  <div
                    style={{
                      flexShrink: 0,
                      width: 26,
                      height: 26,
                      borderRadius: 8,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontFamily: accentFont,
                      fontSize: common.scale(12),
                      fontWeight: 700,
                      color: '#ffffff',
                      background: `linear-gradient(135deg, ${accentColor}, ${highlightColor})`,
                      boxShadow: `0 3px 10px rgba(${accentRgb}, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.25)`,
                    }}
                  >
                    {String(index + 1).padStart(2, '0')}
                  </div>

                  {/* Thumbnail with its own 3D shadow */}
                  <div
                    style={{
                      flexShrink: 0,
                      width: 44,
                      height: 44,
                      borderRadius: 10,
                      overflow: 'hidden',
                      backgroundColor: `rgba(${baseRgb}, 0.6)`,
                      border: `1px solid rgba(255, 255, 255, 0.08)`,
                      boxShadow:
                        '6px 6px 14px rgba(0, 0, 0, 0.45), -1px -1px 4px rgba(255, 255, 255, 0.04)',
                    }}
                  >
                    {item.song?.albumArt ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={item.song.albumArt}
                        alt={getTitle(item)}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          display: 'block',
                        }}
                        draggable={false}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          height: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: highlightColor,
                          fontSize: common.scale(18),
                          fontFamily: headingFont,
                          opacity: 0.7,
                        }}
                      >
                        {'\u266B'}
                      </div>
                    )}
                  </div>

                  {/* Title + requester */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: headingFont,
                        fontSize: common.scale(18),
                        fontWeight: 700,
                        color: textColor,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        textShadow: '0 1px 3px rgba(0, 0, 0, 0.4)',
                      }}
                    >
                      {getTitle(item)}
                    </div>
                    <div
                      style={{
                        fontFamily: bodyFont,
                        fontSize: common.scale(16),
                        marginTop: 2,
                        color: highlightColor,
                        opacity: 0.7,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {getArtist(item)}
                      {data.settings?.showRequesterName !== false && item.requesterNickname ? (
                        <span style={{ opacity: 0.85 }}> · @{item.requesterNickname}</span>
                      ) : null}
                    </div>
                  </div>

                  {/* Tags */}
                  {isDonation && (
                    <span
                      style={{
                        flexShrink: 0,
                        fontFamily: accentFont,
                        fontSize: common.scale(11),
                        letterSpacing: 1,
                        padding: '3px 7px',
                        borderRadius: 999,
                        background: `linear-gradient(135deg, ${accentColor}, ${highlightColor})`,
                        color: '#ffffff',
                        textTransform: 'uppercase',
                        boxShadow: `0 3px 10px rgba(${accentRgb}, 0.4)`,
                      }}
                    >
                      $$
                    </span>
                  )}
                  {isHomework && (
                    <span
                      style={{
                        flexShrink: 0,
                        fontFamily: accentFont,
                        fontSize: common.scale(11),
                        letterSpacing: 1,
                        padding: '3px 7px',
                        borderRadius: 999,
                        backgroundColor: `rgba(${accentRgb}, 0.22)`,
                        border: `1px solid rgba(${accentRgb}, 0.4)`,
                        color: highlightColor,
                        textTransform: 'uppercase',
                      }}
                    >
                      HW
                    </span>
                  )}

                  {isRandom && (
                    <span
                      style={{
                        flexShrink: 0,
                        fontFamily: accentFont,
                        fontSize: common.scale(11),
                        letterSpacing: 1,
                        padding: '3px 7px',
                        borderRadius: 999,
                        backgroundColor: `rgba(${accentRgb}, 0.22)`,
                        border: `1px solid rgba(${accentRgb}, 0.4)`,
                        color: highlightColor,
                        textTransform: 'uppercase',
                      }}
                    >
                      HW
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
Queue.displayName = 'Queue';
export default memo(Queue);
