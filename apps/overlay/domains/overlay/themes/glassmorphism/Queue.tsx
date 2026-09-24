'use client';

import { useMemo, memo} from 'react';
import type { ThemeWidgetProps } from '../types';
import { buildFontFamilyValue, useCommonOptions, useQueueAnimation } from '../shared';
import { defaultOptions, type GlassmorphismOptions } from './config';
import LiquidGlassFilter from './LiquidGlassFilter';
import type { SongRequest } from '../../types/overlay';

const LIQUID_FILTER_ID = 'liquid-glass-queue';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): GlassmorphismOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<GlassmorphismOptions>),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
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
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['Pretendard', 'sans-serif']),
    [common.fontFamily, fonts.roles.body],
  );
  const accentFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.accent ?? ['Inter', 'monospace']),
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

  const cardOpacity = clamp(options.cardOpacity, 0, 100) / 100;
  const textColor = common.textColor ?? options.textColor ?? '#ffffff';
  const accentColor = common.accentColor ?? textColor;
  const gradientStart = options.gradientStart || '#667eea';
  const gradientEnd = options.gradientEnd || '#764ba2';

  const glassOpacity = clamp(options.glassOpacity ?? 0.28, 0.1, 0.6);
  const glassBlur = clamp(options.glassBlur ?? 20, 8, 40);

  // Common transparency controls
  const blurPx = common.blurIntensity;
  const borderOpacity = common.borderOpacity;

  // Inner queue items use a flat translucent background only — the outer
  // frame already has backdrop-filter blur. Stacking blur per item is
  // very expensive (each blur creates a new compositing surface).
  const innerCardBg = `rgba(255, 255, 255, ${Math.max(cardOpacity * 0.7, 0.06)})`;

  const enterDuration = animations['queue.add']?.enterDuration ?? 400;
  const stagger = animations['queue.add']?.stagger ?? 0;
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
    position: 'relative',
    overflow: 'hidden',
  }), [bodyFont, common.textSizeMultiplier, common.fontWeight, textColor]);

  const frameStyle: React.CSSProperties = useMemo(() => {
    const effectiveGlassOpacity = glassOpacity * common.backgroundOpacity;
    const liquidFilter = `url(#${LIQUID_FILTER_ID}) blur(${glassBlur}px) saturate(180%)`;
    const fallbackFilter = `blur(${blurPx}px) saturate(180%)`;
    return {
      position: 'relative',
      flex: 1,
      width: '100%',
      padding: 18,
      borderRadius: 24,
      backgroundColor: `rgba(18, 18, 24, ${effectiveGlassOpacity})`,
      backdropFilter: liquidFilter,
      WebkitBackdropFilter: fallbackFilter,
      border: `1.5px solid rgba(255, 255, 255, ${0.32 * borderOpacity})`,
      boxShadow: [
        `inset 0 1.5px 0 rgba(255, 255, 255, ${0.72 * common.backgroundOpacity})`,
        `inset 0 -1px 0 rgba(0, 0, 0, ${0.22 * common.backgroundOpacity})`,
        `inset 1.5px 0 0 rgba(255, 255, 255, ${0.22 * common.backgroundOpacity})`,
        `inset -1.5px 0 0 rgba(255, 255, 255, ${0.22 * common.backgroundOpacity})`,
      ].join(', '),
      overflow: 'hidden',
    };
  }, [glassBlur, glassOpacity, blurPx, borderOpacity, common.backgroundOpacity]);

  const specularStyle: React.CSSProperties = useMemo(() => ({
    position: 'absolute',
    inset: 0,
    borderRadius: 24,
    pointerEvents: 'none',
    zIndex: 0,
    background: [
      'radial-gradient(ellipse 75% 50% at 18% 6%, rgba(255,255,255,0.58) 0%, rgba(255,255,255,0.22) 26%, rgba(255,255,255,0) 58%)',
      'radial-gradient(ellipse 50% 32% at 88% 92%, rgba(255,255,255,0.26) 0%, rgba(255,255,255,0) 64%)',
      'linear-gradient(135deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 38%, rgba(255,255,255,0) 68%, rgba(255,255,255,0.12) 100%)',
    ].join(', '),
    mixBlendMode: 'overlay',
  }), []);

  const contentLayerStyle: React.CSSProperties = useMemo(() => ({
    position: 'relative',
    zIndex: 1,
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
  }), []);

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
      <LiquidGlassFilter id={LIQUID_FILTER_ID} />
      <div style={frameStyle}>
        <div aria-hidden style={specularStyle} />
        <div style={contentLayerStyle}>
        <div style={headerStyle}>
          <div
            style={{
              fontFamily: headingFont,
              fontSize: common.scale(16),
              fontWeight: 700,
              color: textColor,
              letterSpacing: 0.5,
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
              padding: '3px 8px',
              borderRadius: 999,
              backgroundColor: 'rgba(255, 255, 255, 0.14)',
              border: `1px solid rgba(255, 255, 255, 0.22)`,
              color: textColor,
              opacity: 0.85,
            }}
          >
            {totalQueue.toString().padStart(2, '0')} queued
          </span>
        </div>

        {isEmpty ? (
          <div
            style={{
              padding: '28px 12px',
              textAlign: 'center',
              fontFamily: bodyFont,
              fontSize: common.scale(13),
              color: textColor,
              opacity: 0.55,
              border: `1px dashed rgba(255, 255, 255, ${Math.max(borderOpacity * 0.7, 0.12)})`,
              borderRadius: 16,
              backgroundColor: 'rgba(255, 255, 255, 0.04)',
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

              const animation =
                phase === 'entering' && !reducedMotion
                  ? `glassmorphism-glass-soft-drop ${enterDuration}ms ${easing} ${stagger * index}ms 1 both`
                  : undefined;

              return (
                <li
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: 10,
                    borderRadius: 14,
                    backgroundColor: isDonation
                      ? `rgba(255, 255, 255, ${Math.min(cardOpacity * 1.5 + 0.05, 0.35)})`
                      : innerCardBg,
                    border: `1px solid rgba(255, 255, 255, ${
                      isDonation ? Math.min(borderOpacity * 2, 0.5) : borderOpacity * 0.9
                    })`,
                    boxShadow: isDonation
                      ? '0 4px 20px rgba(255, 255, 255, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.3)'
                      : '0 2px 10px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.18)',
                    animation,
                  }}
                >
                  {/* Index badge */}
                  <div
                    style={{
                      flexShrink: 0,
                      width: 24,
                      height: 24,
                      borderRadius: 8,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontFamily: accentFont,
                      fontSize: common.scale(12),
                      fontWeight: 700,
                      color: textColor,
                      backgroundColor: 'rgba(255, 255, 255, 0.15)',
                      border: `1px solid rgba(255, 255, 255, 0.22)`,
                    }}
                  >
                    {String(index + 1).padStart(2, '0')}
                  </div>

                  {/* Thumbnail */}
                  <div
                    style={{
                      flexShrink: 0,
                      width: 44,
                      height: 44,
                      borderRadius: 10,
                      overflow: 'hidden',
                      backgroundColor: 'rgba(255, 255, 255, 0.08)',
                      border: `1px solid rgba(255, 255, 255, ${borderOpacity * 0.8})`,
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
                          color: textColor,
                          opacity: 0.55,
                          fontSize: common.scale(18),
                          fontFamily: headingFont,
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
                        fontWeight: 600,
                        color: textColor,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {getTitle(item)}
                    </div>
                    <div
                      style={{
                        fontFamily: bodyFont,
                        fontSize: common.scale(16),
                        marginTop: 1,
                        color: textColor,
                        opacity: 0.55,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {getArtist(item)}
                      {data.settings?.showRequesterName !== false && item.requesterNickname ? (
                        <span style={{ opacity: 0.8 }}> · @{item.requesterNickname}</span>
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
                        backgroundColor: 'rgba(255, 255, 255, 0.25)',
                        border: `1px solid rgba(255, 255, 255, 0.4)`,
                        color: textColor,
                        textTransform: 'uppercase',
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
                        backgroundColor: 'rgba(255, 255, 255, 0.14)',
                        border: `1px solid rgba(255, 255, 255, 0.26)`,
                        color: textColor,
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
                        backgroundColor: 'rgba(255, 255, 255, 0.14)',
                        border: `1px solid rgba(255, 255, 255, 0.26)`,
                        color: textColor,
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
    </div>
  );
}
Queue.displayName = 'Queue';
export default memo(Queue);
