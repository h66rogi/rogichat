'use client';

import { useMemo, memo} from 'react';
import type { ThemeWidgetProps } from '../types';
import { buildFontFamilyValue, useCommonOptions, useQueueAnimation } from '../shared';
import { hexToRgba, withOpacity, buildBlurFilter } from '../shared/apply-transparency';
import { defaultOptions, type RetroPixelOptions } from './config';
import type { SongRequest } from '../../types/overlay';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): RetroPixelOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<RetroPixelOptions>),
  };
}

function clampGlow(intensity: number): number {
  if (Number.isNaN(intensity)) return 60;
  return Math.max(0, Math.min(100, intensity));
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
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.heading ?? ['monospace']),
    [common.fontFamily, fonts.roles.heading],
  );
  const bodyFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['monospace']),
    [common.fontFamily, fonts.roles.body],
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
  const glowAlpha = 0.35 + (glow / 100) * 0.55;
  const glowBlur = 6 + (glow / 100) * 18;
  const borderColor = options.primaryColor;
  const accentColor = common.accentColor ?? options.accentColor;
  const bodyTextColor = common.textColor ?? accentColor;
  const bgColor = options.backgroundColor;
  const pixelScale = Math.max(1, Math.min(4, options.pixelScale ?? 2));
  const borderWidth = pixelScale * 2;

  const titleShadow = `0 0 ${glowBlur * 0.6}px rgba(255, 110, 199, ${glowAlpha}), 2px 2px 0 rgba(0, 0, 0, 0.85)`;
  const accentShadow = `0 0 ${glowBlur * 0.5}px rgba(0, 255, 247, ${glowAlpha * 0.8}), 1px 1px 0 rgba(0, 0, 0, 0.85)`;

  const enterDuration = animations['queue.add']?.enterDuration ?? 300;
  const stagger = animations['queue.add']?.stagger ?? 0;

  const containerStyle: React.CSSProperties = useMemo(() => ({
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: bodyFont,
    fontWeight: common.fontWeight,
    color: bodyTextColor,
    background: 'transparent',
  }), [bodyFont, bodyTextColor, common.textSizeMultiplier, common.fontWeight]);

  const frameStyle: React.CSSProperties = useMemo(() => ({
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    backgroundColor: hexToRgba(bgColor, common.backgroundOpacity),
    border: `${borderWidth}px solid ${withOpacity(borderColor, common.borderOpacity)}`,
    borderRadius: 0,
    padding: pixelScale * 8,
    position: 'relative',
    boxShadow: `0 0 0 ${pixelScale}px rgba(0, 0, 0, 0.85)`,
    overflow: 'hidden',
    imageRendering: 'pixelated',
    backdropFilter: buildBlurFilter(common.blurIntensity),
    WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
  }), [bgColor, borderColor, borderWidth, pixelScale, common.backgroundOpacity, common.borderOpacity, common.blurIntensity]);

  const headerStyle: React.CSSProperties = useMemo(() => ({
    fontFamily: headingFont,
    color: borderColor,
    fontSize: common.scale(18),
    letterSpacing: 2,
    paddingBottom: pixelScale * 4,
    marginBottom: pixelScale * 6,
    borderBottom: `${pixelScale}px dashed ${accentColor}`,
    textShadow: `0 0 ${glowBlur * 0.6}px rgba(255, 110, 199, ${glowAlpha}), 2px 2px 0 rgba(0, 0, 0, 0.85)`,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    textTransform: 'uppercase',
  }), [accentColor, borderColor, glowAlpha, glowBlur, headingFont, pixelScale, common.textSizeMultiplier]);

  const isEmpty = queue.length === 0;

  return (
    <div style={containerStyle}>
      <div style={frameStyle}>
        {options.showScanlines && <ScanlinesOverlay />}
        <CrtCorners color={borderColor} pixelScale={pixelScale} />

        <div style={headerStyle}>
          <span aria-hidden="true">{'\u25C6'}</span>
          <span>NEXT UP</span>
          <span
            style={{
              marginLeft: 'auto',
              fontSize: common.scale(14),
              color: accentColor,
              textShadow: accentShadow,
              letterSpacing: 1.5,
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
              padding: pixelScale * 8,
              border: `${pixelScale}px dashed ${accentColor}`,
              fontFamily: headingFont,
              fontSize: common.scale(14),
              color: accentColor,
              textShadow: accentShadow,
              letterSpacing: 1,
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
              gap: pixelScale * 4,
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
                  ? `retro-pixel-drop-in ${enterDuration}ms steps(6, end) ${stagger * index}ms 1 both`
                  : undefined;

              return (
                <li
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: pixelScale * 6,
                    padding: pixelScale * 4,
                    backgroundColor: isDonation
                      ? `${borderColor}22`
                      : 'rgba(0, 0, 0, 0.55)',
                    border: `${pixelScale}px solid ${
                      isDonation ? borderColor : accentColor
                    }`,
                    animation,
                  }}
                >
                  <span
                    style={{
                      fontFamily: headingFont,
                      fontSize: common.scale(12),
                      color: bgColor,
                      backgroundColor: isDonation ? borderColor : accentColor,
                      padding: '4px 6px',
                      letterSpacing: 1,
                      textShadow: 'none',
                      flexShrink: 0,
                    }}
                  >
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: headingFont,
                        fontSize: common.scale(18),
                        color: borderColor,
                        textShadow: titleShadow,
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
                        color: accentColor,
                        textShadow: accentShadow,
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        marginTop: 2,
                      }}
                    >
                      {getArtist(item)}
                      {data.settings?.showRequesterName !== false && item.requesterNickname ? (
                        <span style={{ opacity: 0.8 }}> · @{item.requesterNickname}</span>
                      ) : null}
                    </div>
                  </div>
                  {isDonation && (
                    <span
                      style={{
                        fontFamily: headingFont,
                        fontSize: common.scale(11),
                        color: bgColor,
                        backgroundColor: borderColor,
                        padding: '2px 5px',
                        letterSpacing: 1,
                        flexShrink: 0,
                      }}
                    >
                      $$
                    </span>
                  )}
                  {isHomework && (
                    <span
                      style={{
                        fontFamily: headingFont,
                        fontSize: common.scale(11),
                        color: bgColor,
                        backgroundColor: accentColor,
                        padding: '2px 5px',
                        letterSpacing: 1,
                        flexShrink: 0,
                      }}
                    >
                      HW
                    </span>
                  )}

                  {isRandom && (
                    <span
                      style={{
                        fontFamily: headingFont,
                        fontSize: common.scale(11),
                        color: bgColor,
                        backgroundColor: accentColor,
                        padding: '2px 5px',
                        letterSpacing: 1,
                        flexShrink: 0,
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

function ScanlinesOverlay() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        backgroundImage:
          'repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.45) 0, rgba(0, 0, 0, 0.45) 1px, transparent 1px, transparent 3px)',
        mixBlendMode: 'multiply',
        opacity: 0.55,
      }}
    />
  );
}

function CrtCorners({ color, pixelScale }: { color: string; pixelScale: number }) {
  const size = pixelScale * 4 + 4;
  const corner: React.CSSProperties = {
    position: 'absolute',
    width: size,
    height: size,
    pointerEvents: 'none',
  };
  const lineThickness = Math.max(2, pixelScale);
  const horizontal: React.CSSProperties = {
    position: 'absolute',
    width: size,
    height: lineThickness,
    backgroundColor: color,
  };
  const vertical: React.CSSProperties = {
    position: 'absolute',
    width: lineThickness,
    height: size,
    backgroundColor: color,
  };
  return (
    <>
      <div aria-hidden="true" style={{ ...corner, top: -lineThickness, left: -lineThickness }}>
        <div style={{ ...horizontal, top: 0, left: 0 }} />
        <div style={{ ...vertical, top: 0, left: 0 }} />
      </div>
      <div aria-hidden="true" style={{ ...corner, top: -lineThickness, right: -lineThickness }}>
        <div style={{ ...horizontal, top: 0, right: 0 }} />
        <div style={{ ...vertical, top: 0, right: 0 }} />
      </div>
      <div aria-hidden="true" style={{ ...corner, bottom: -lineThickness, left: -lineThickness }}>
        <div style={{ ...horizontal, bottom: 0, left: 0 }} />
        <div style={{ ...vertical, bottom: 0, left: 0 }} />
      </div>
      <div aria-hidden="true" style={{ ...corner, bottom: -lineThickness, right: -lineThickness }}>
        <div style={{ ...horizontal, bottom: 0, right: 0 }} />
        <div style={{ ...vertical, bottom: 0, right: 0 }} />
      </div>
    </>
  );
}
Queue.displayName = 'Queue';
export default memo(Queue);
