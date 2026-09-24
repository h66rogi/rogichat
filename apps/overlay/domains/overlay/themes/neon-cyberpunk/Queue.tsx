'use client';

import { useMemo, memo} from 'react';
import type { ThemeWidgetProps } from '../types';
import { buildFontFamilyValue, useCommonOptions, useQueueAnimation } from '../shared';
import { hexToRgba, buildBlurFilter } from '../shared/apply-transparency';
import { defaultOptions, type NeonCyberpunkOptions } from './config';
import type { SongRequest } from '../../types/overlay';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): NeonCyberpunkOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<NeonCyberpunkOptions>),
  };
}

function clampGlow(intensity: number): number {
  if (Number.isNaN(intensity)) return 75;
  return Math.max(0, Math.min(100, intensity));
}

/** Convert "#rrggbb" to "r, g, b" for use in rgba() text-shadow strings. */
function hexToRgbTriplet(hex: string, fallback = '255, 0, 255'): string {
  const match = hex.trim().match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!match) return fallback;
  const r = parseInt(match[1], 16);
  const g = parseInt(match[2], 16);
  const b = parseInt(match[3], 16);
  return `${r}, ${g}, ${b}`;
}

function getTitle(item: SongRequest): string {
  return item.song?.title || item.rawTitle || 'UNKNOWN';
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
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.heading ?? ['Orbitron', 'sans-serif']),
    [common.fontFamily, fonts.roles.heading],
  );
  const bodyFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['Rajdhani', 'sans-serif']),
    [common.fontFamily, fonts.roles.body],
  );
  const accentFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.accent ?? ['Orbitron', 'monospace']),
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

  const glow = clampGlow(options.glowIntensity);
  const glowScale = 0.2 + (glow / 100) * 0.9;

  const primaryNeon = common.accentColor ?? options.primaryNeon ?? '#ff00ff';
  const secondaryNeon = common.textColor ?? options.secondaryNeon ?? '#00fff7';
  const accentNeon = options.accentNeon || '#7b2ff7';
  const bgColor = options.backgroundColor || '#05000a';

  const primaryRgb = hexToRgbTriplet(primaryNeon, '255, 0, 255');
  const secondaryRgb = hexToRgbTriplet(secondaryNeon, '0, 255, 247');
  const accentRgb = hexToRgbTriplet(accentNeon, '123, 47, 247');

  const buildNeonTextShadow = (rgbTriplet: string, scale: number) => {
    const inner = `0 0 ${10 * scale}px rgba(${rgbTriplet}, ${Math.min(1, 0.95 * scale)})`;
    const mid = `0 0 ${20 * scale}px rgba(${rgbTriplet}, ${Math.min(1, 0.7 * scale)})`;
    const outer = `0 0 ${36 * scale}px rgba(${rgbTriplet}, ${Math.min(1, 0.45 * scale)})`;
    return `${inner}, ${mid}, ${outer}`;
  };

  const primaryShadow = buildNeonTextShadow(primaryRgb, glowScale);
  const secondaryShadow = buildNeonTextShadow(secondaryRgb, glowScale * 0.65);
  const accentShadow = buildNeonTextShadow(accentRgb, glowScale * 0.55);

  const enterDuration = animations['queue.add']?.enterDuration ?? 450;
  const stagger = animations['queue.add']?.stagger ?? 80;

  const containerStyle: React.CSSProperties = useMemo(() => ({
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: bodyFont,
    fontWeight: common.fontWeight,
    color: secondaryNeon,
    background: 'transparent',
  }), [bodyFont, common.textSizeMultiplier, common.fontWeight, secondaryNeon]);

  // React Compiler handles memoization for these styles; manual useMemo
  // would conflict with deps that the compiler considers potentially mutated
  // (primaryRgb / secondaryRgb are also passed as JSX props elsewhere).
  const frameStyle: React.CSSProperties = {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    position: 'relative',
    padding: '16px 18px',
    backgroundColor: hexToRgba(bgColor, common.backgroundOpacity),
    border: `1px solid rgba(${primaryRgb}, ${0.35 * common.borderOpacity})`,
    boxShadow: `inset 0 0 ${26 * glowScale}px rgba(${primaryRgb}, ${0.08 * glowScale})`,
    borderRadius: 2,
    overflow: 'hidden',
    backdropFilter: buildBlurFilter(common.blurIntensity),
    WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
    paddingBottom: 10,
    borderBottom: `1px solid rgba(${secondaryRgb}, 0.3)`,
  };

  const isEmpty = queue.length === 0;

  return (
    <div style={containerStyle}>
      <div style={frameStyle}>
        {options.showScanlines && <ScanlineOverlay />}
        <NeonEdges primaryRgb={primaryRgb} secondaryRgb={secondaryRgb} glowScale={glowScale} />

        <div style={headerStyle}>
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: primaryNeon,
              boxShadow: `0 0 6px ${primaryNeon}, 0 0 12px ${primaryNeon}`,
            }}
          />
          <span
            style={{
              fontFamily: accentFont,
              fontSize: common.scale(12),
              letterSpacing: 3,
              textTransform: 'uppercase',
              color: primaryNeon,
              textShadow: primaryShadow,
            }}
          >
            QUEUE
          </span>
          <span
            style={{
              marginLeft: 'auto',
              fontFamily: accentFont,
              fontSize: common.scale(11),
              letterSpacing: 2,
              color: secondaryNeon,
              textShadow: secondaryShadow,
            }}
          >
            x{(data?.queue ?? []).length.toString().padStart(2, '0')}
          </span>
        </div>

        {isEmpty ? (
          <div
            style={{
              minHeight: 120,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
              fontFamily: headingFont,
              fontSize: common.scale(13),
              letterSpacing: 2,
              color: secondaryNeon,
              textShadow: secondaryShadow,
              textTransform: 'uppercase',
            }}
          >
            QUEUE EMPTY
          </div>
        ) : (
          <ul data-overlay-scroll
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
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
                  ? `neon-cyberpunk-scan-sweep ${enterDuration}ms ease-out ${stagger * index}ms 1 both`
                  : undefined;

              const isLast = index === animatedItems.length - 1;

              return (
                <li
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 6px',
                    borderBottom: isLast ? 'none' : `1px solid rgba(${secondaryRgb}, 0.18)`,
                    animation: animationCss,
                    // Background gradient is used by scan-sweep to create the
                    // sweeping highlight during the animation.
                    backgroundImage: isDonation
                      ? `linear-gradient(90deg, rgba(${primaryRgb}, 0.08) 0%, rgba(${primaryRgb}, 0.18) 50%, rgba(${primaryRgb}, 0.08) 100%)`
                      : `linear-gradient(90deg, rgba(${secondaryRgb}, 0) 0%, rgba(${secondaryRgb}, 0.1) 50%, rgba(${secondaryRgb}, 0) 100%)`,
                    backgroundSize: '200% 100%',
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      fontFamily: accentFont,
                      fontSize: common.scale(16),
                      fontWeight: 700,
                      width: 28,
                      textAlign: 'center',
                      color: primaryNeon,
                      textShadow: primaryShadow,
                      letterSpacing: 0.5,
                    }}
                  >
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: headingFont,
                        fontSize: common.scale(18),
                        fontWeight: 700,
                        color: '#ffffff',
                        textShadow: `0 0 ${6 * glowScale}px rgba(255, 255, 255, ${0.4 * glowScale})`,
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
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
                        marginTop: 2,
                        color: secondaryNeon,
                        textShadow: secondaryShadow,
                        letterSpacing: 0.3,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {getArtist(item)}
                      {data.settings?.showRequesterName !== false && item.requesterNickname ? (
                        <span
                          style={{
                            marginLeft: 6,
                            color: accentNeon,
                            textShadow: accentShadow,
                            opacity: 0.85,
                          }}
                        >
                          @{item.requesterNickname}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {isDonation && (
                    <span
                      style={{
                        flexShrink: 0,
                        fontFamily: accentFont,
                        fontSize: common.scale(11),
                        padding: '2px 6px',
                        border: `1px solid rgba(${primaryRgb}, 0.8)`,
                        color: primaryNeon,
                        textShadow: primaryShadow,
                        letterSpacing: 1.5,
                      }}
                    >
                      TIP
                    </span>
                  )}
                  {isHomework && (
                    <span
                      style={{
                        flexShrink: 0,
                        fontFamily: accentFont,
                        fontSize: common.scale(11),
                        padding: '2px 6px',
                        border: `1px solid rgba(${secondaryRgb}, 0.8)`,
                        color: secondaryNeon,
                        textShadow: secondaryShadow,
                        letterSpacing: 1.5,
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
                        padding: '2px 6px',
                        border: `1px solid rgba(${secondaryRgb}, 0.8)`,
                        color: secondaryNeon,
                        textShadow: secondaryShadow,
                        letterSpacing: 1.5,
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

function ScanlineOverlay() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        backgroundImage:
          'repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.32) 0, rgba(0, 0, 0, 0.32) 1px, transparent 1px, transparent 3px)',
        mixBlendMode: 'multiply',
        opacity: 0.7,
      }}
    />
  );
}

function NeonEdges({
  primaryRgb,
  secondaryRgb,
  glowScale,
}: {
  primaryRgb: string;
  secondaryRgb: string;
  glowScale: number;
}) {
  const topLine: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    background: `linear-gradient(90deg, rgba(${primaryRgb}, 0) 0%, rgba(${primaryRgb}, 1) 50%, rgba(${secondaryRgb}, 0) 100%)`,
    boxShadow: `0 0 ${8 * glowScale}px rgba(${primaryRgb}, ${0.8 * glowScale})`,
    pointerEvents: 'none',
  };
  const bottomLine: React.CSSProperties = {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 1,
    background: `linear-gradient(90deg, rgba(${secondaryRgb}, 0) 0%, rgba(${secondaryRgb}, 1) 50%, rgba(${primaryRgb}, 0) 100%)`,
    boxShadow: `0 0 ${8 * glowScale}px rgba(${secondaryRgb}, ${0.8 * glowScale})`,
    pointerEvents: 'none',
  };
  return (
    <>
      <div aria-hidden="true" style={topLine} />
      <div aria-hidden="true" style={bottomLine} />
    </>
  );
}
Queue.displayName = 'Queue';
export default memo(Queue);
