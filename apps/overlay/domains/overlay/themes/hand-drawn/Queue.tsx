'use client';

import { useMemo, memo} from 'react';
import type { ThemeWidgetProps } from '../types';
import { buildFontFamilyValue, useCommonOptions, useQueueAnimation } from '../shared';
import { hexToRgba, withOpacity, buildBlurFilter } from '../shared/apply-transparency';
import { defaultOptions, type HandDrawnOptions } from './config';
import type { SongRequest } from '../../types/overlay';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): HandDrawnOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<HandDrawnOptions>),
  };
}

function clampTilt(value: number): number {
  if (Number.isNaN(value)) return 2;
  return Math.max(0, Math.min(5, value));
}

function clampRoughness(value: number): number {
  if (Number.isNaN(value)) return 2;
  return Math.max(1, Math.min(4, value));
}

function getTitle(item: SongRequest): string {
  return item.song?.title || item.rawTitle || 'Unknown';
}

function getArtist(item: SongRequest): string {
  return item.song?.artist?.name || item.rawArtist || '';
}

/**
 * Stable pseudo-random tilt based on the item id, alternating sign by index
 * so adjacent sticky notes lean in different directions like a real cork board.
 */
function tiltForIndex(seed: string | number, index: number, tiltMax: number): number {
  const text = String(seed);
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  const norm = ((hash >>> 0) % 1000) / 1000;
  const sign = index % 2 === 0 ? -1 : 1;
  // 0.4 → tiltMax (so it never reads as perfectly straight)
  const magnitude = 0.4 + norm * Math.max(0, tiltMax - 0.4);
  return parseFloat((sign * magnitude).toFixed(2));
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
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.heading ?? ['Caveat', 'cursive']),
    [common.fontFamily, fonts.roles.heading],
  );
  const bodyFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['Patrick Hand', 'sans-serif']),
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

  const paperColor = options.paperColor || '#faf5eb';
  const inkColor = common.textColor ?? options.inkColor ?? '#2c2c2c';
  const accentColor = common.accentColor ?? options.accentColor ?? '#ff6b6b';
  const highlightColor = options.highlightColor || '#ffeb3b';
  const tiltMax = clampTilt(options.tiltMax);
  const roughness = clampRoughness(options.borderRoughness);
  const showTape = options.showTape !== false;

  const enterDuration = animations['queue.add']?.enterDuration ?? 450;
  const stagger = animations['queue.add']?.stagger ?? 80;

  const containerStyle: React.CSSProperties = useMemo(() => ({
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: bodyFont,
    fontWeight: common.fontWeight,
    color: inkColor,
    background: 'transparent',
  }), [bodyFont, common.textSizeMultiplier, common.fontWeight, inkColor]);

  const cardStyle: React.CSSProperties = useMemo(() => ({
    position: 'relative',
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    padding: '24px 22px 20px 22px',
    backgroundColor: hexToRgba(paperColor, common.backgroundOpacity),
    // Subtle "lined paper" pattern (very subtle horizontal rule lines).
    backgroundImage: `repeating-linear-gradient(
      to bottom,
      transparent 0px,
      transparent 24px,
      ${inkColor}10 24px,
      ${inkColor}10 25px
    )`,
    borderRadius: 6 + roughness,
    border: `${roughness}px solid ${withOpacity(inkColor, common.borderOpacity)}`,
    transform: 'rotate(-0.6deg)',
    overflow: 'visible',
    backdropFilter: buildBlurFilter(common.blurIntensity),
    WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
  }), [inkColor, paperColor, roughness, common.backgroundOpacity, common.borderOpacity, common.blurIntensity]);

  const tapeStyle: React.CSSProperties = useMemo(() => ({
    position: 'absolute',
    top: -12,
    left: '50%',
    width: 90,
    height: 22,
    marginLeft: -45,
    background: `linear-gradient(180deg, ${highlightColor}cc, ${highlightColor}88)`,
    border: `1px solid ${inkColor}33`,
    transform: 'rotate(-3deg)',
    boxShadow: '0 2px 4px rgba(0,0,0,0.12)',
    pointerEvents: 'none',
  }), [highlightColor, inkColor]);

  const headerStyle: React.CSSProperties = useMemo(() => ({
    fontFamily: headingFont,
    fontSize: common.scale(24),
    fontWeight: 700,
    color: inkColor,
    marginBottom: 12,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 8,
    borderBottom: `${Math.max(1, roughness - 1)}px dashed ${inkColor}66`,
  }), [headingFont, inkColor, roughness, common.textSizeMultiplier]);

  const isEmpty = queue.length === 0;

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        {showTape && <div aria-hidden="true" style={tapeStyle} />}

        <div style={headerStyle}>
          <span aria-hidden="true">{'\u{1F4D6}'}</span>
          <span>다음 곡</span>
          <span
            style={{
              marginLeft: 'auto',
              fontFamily: bodyFont,
              fontSize: common.scale(13),
              fontStyle: 'italic',
              color: inkColor,
              opacity: 0.55,
              fontWeight: 400,
            }}
          >
            x{(data?.queue ?? []).length}
          </span>
        </div>

        {isEmpty ? (
          <div
            style={{
              minHeight: 120,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 20,
              border: `${roughness}px dashed ${inkColor}55`,
              fontFamily: headingFont,
              fontSize: common.scale(18),
              color: inkColor,
              opacity: 0.55,
              fontStyle: 'italic',
              textAlign: 'center',
            }}
          >
            {'\u270F\uFE0F'} 대기 중인 곡이 없어요...
          </div>
        ) : (
          <ul data-overlay-scroll
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
            }}
          >
            {animatedItems.map(({ item, phase, index }) => {
              const isDonation = (item.donationAmount ?? 0) > 0;
              const isHomework = !!item.isHomework;

              const isRandom = !!item.isRandom;
              const tiltDeg = tiltForIndex(item.id, index, tiltMax);

              const animation =
                phase === 'entering' && !reducedMotion
                  ? `hand-drawn-sticker-stick ${enterDuration}ms cubic-bezier(0.34, 1.56, 0.64, 1) ${stagger * index}ms 1 both`
                  : undefined;

              return (
                <li
                  key={item.id}
                  style={{
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 14px 10px 12px',
                    backgroundColor: isDonation
                      ? `${highlightColor}55`
                      : `${paperColor}`,
                    border: `${roughness}px solid ${isDonation ? accentColor : inkColor}`,
                    borderRadius: 4 + roughness,
                    boxShadow: '0 3px 8px rgba(0,0,0,0.12)',
                    transform: `rotate(${tiltDeg}deg)`,
                    animation,
                  }}
                >
                  {/* Paper clip on the top-left */}
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      top: -10,
                      left: 6,
                      fontSize: common.scale(16),
                      transform: 'rotate(-22deg)',
                      filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.25))',
                      pointerEvents: 'none',
                    }}
                  >
                    {'\u{1F4CE}'}
                  </span>

                  <span
                    style={{
                      fontFamily: headingFont,
                      fontSize: common.scale(20),
                      fontWeight: 700,
                      color: isDonation ? accentColor : inkColor,
                      flexShrink: 0,
                      width: 22,
                      textAlign: 'center',
                    }}
                  >
                    {index + 1}.
                  </span>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: headingFont,
                        fontSize: common.scale(20),
                        fontWeight: 700,
                        color: inkColor,
                        lineHeight: 1.15,
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
                        color: inkColor,
                        opacity: 0.6,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        marginTop: 1,
                      }}
                    >
                      by {getArtist(item)}
                      {data.settings?.showRequesterName !== false && item.requesterNickname ? (
                        <span style={{ marginLeft: 6, fontStyle: 'italic' }}>
                          @{item.requesterNickname}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {isDonation && (
                    <span
                      aria-hidden="true"
                      style={{
                        fontFamily: headingFont,
                        fontSize: common.scale(14),
                        fontWeight: 700,
                        color: accentColor,
                        flexShrink: 0,
                      }}
                    >
                      {'\u2605'}
                    </span>
                  )}
                  {isHomework && (
                    <span
                      style={{
                        fontFamily: headingFont,
                        fontSize: common.scale(14),
                        color: accentColor,
                        border: `${Math.max(1, roughness - 1)}px dashed ${accentColor}`,
                        padding: '1px 6px',
                        flexShrink: 0,
                      }}
                    >
                      숙제
                    </span>
                  )}

                  {isRandom && (
                    <span
                      style={{
                        fontFamily: headingFont,
                        fontSize: common.scale(14),
                        color: accentColor,
                        border: `${Math.max(1, roughness - 1)}px dashed ${accentColor}`,
                        padding: '1px 6px',
                        flexShrink: 0,
                      }}
                    >
                      랜덤
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
