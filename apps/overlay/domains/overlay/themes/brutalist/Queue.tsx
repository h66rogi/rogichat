'use client';

import { useMemo, memo} from 'react';
import type { ThemeWidgetProps } from '../types';
import { buildFontFamilyValue, useCommonOptions, useQueueAnimation } from '../shared';
import { hexToRgba, withOpacity, buildBlurFilter } from '../shared/apply-transparency';
import { defaultOptions, type BrutalistOptions } from './config';
import type { SongRequest } from '../../types/overlay';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): BrutalistOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<BrutalistOptions>),
  };
}

// Each card gets a tilt pulled from this array. Intentionally jittery so
// the queue looks like stacked printed flyers rather than a clean list.
const ALTERNATING_TILTS = [-1, 1, -1.5, 1.5, -1] as const;

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function getTitle(item: SongRequest): string {
  return item.song?.title || item.rawTitle || 'UNTITLED';
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
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['Inter', 'sans-serif']),
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

  const borderWidth = clampNumber(options.borderWidth, 2, 8, 5);
  const shadowOffset = clampNumber(options.shadowOffset, 4, 16, 10);
  const tiltAngle = clampNumber(options.tiltAngle, -5, 5, -1);
  const accentColor = common.accentColor ?? options.accentColor ?? '#ffff00';
  const bgColor = options.backgroundColor || '#f5f5dc';

  const hardShadow = `${shadowOffset}px ${shadowOffset}px 0 #000`;
  const ink = common.textColor ?? '#000000';

  const enterDuration = animations['queue.add']?.enterDuration ?? 200;
  const stagger = animations['queue.add']?.stagger ?? 40;

  const containerStyle: React.CSSProperties = useMemo(() => ({
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: bodyFont,
    fontWeight: common.fontWeight,
    color: ink,
    background: 'transparent',
    padding: 16,
  }), [bodyFont, common.textSizeMultiplier, common.fontWeight, ink]);

  const frameStyle: React.CSSProperties = useMemo(() => ({
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    backgroundColor: hexToRgba(bgColor, common.backgroundOpacity),
    border: `${borderWidth}px solid ${withOpacity(ink, common.borderOpacity)}`,
    borderRadius: 0,
    padding: 16,
    transform: tiltAngle === 0 ? undefined : `rotate(${tiltAngle}deg)`,
    transformOrigin: 'center center',
    backdropFilter: buildBlurFilter(common.blurIntensity),
    WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
  }), [bgColor, borderWidth, ink, tiltAngle, common.backgroundOpacity, common.borderOpacity, common.blurIntensity]);

  const headerStyle: React.CSSProperties = useMemo(() => ({
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 12,
    marginBottom: 14,
    borderBottom: `${borderWidth}px solid ${ink}`,
  }), [borderWidth, ink]);

  const isEmpty = queue.length === 0;
  const totalQueue = (data?.queue ?? []).length;

  return (
    <div style={containerStyle}>
      <div style={frameStyle}>
        <div style={headerStyle}>
          <span
            style={{
              fontFamily: headingFont,
              fontWeight: 900,
              fontSize: common.scale(24),
              letterSpacing: -0.5,
              textTransform: 'uppercase',
              color: ink,
              backgroundColor: accentColor,
              padding: '4px 10px',
              border: `${Math.max(2, borderWidth - 1)}px solid ${ink}`,
              boxShadow: '3px 3px 0 #000',
              transform: 'rotate(-1.5deg)',
              display: 'inline-block',
            }}
          >
            NEXT UP
          </span>
          <span
            style={{
              marginLeft: 'auto',
              fontFamily: headingFont,
              fontWeight: 900,
              fontSize: common.scale(16),
              letterSpacing: 1,
              color: ink,
              backgroundColor: '#ffffff',
              padding: '3px 8px',
              border: `${Math.max(2, borderWidth - 1)}px solid ${ink}`,
              boxShadow: '3px 3px 0 #000',
              transform: 'rotate(2deg)',
            }}
          >
            x{totalQueue.toString().padStart(2, '0')}
          </span>
        </div>

        {isEmpty ? (
          <div
            style={{
              padding: '32px 12px',
              border: `${borderWidth}px dashed ${ink}`,
              textAlign: 'center',
              fontFamily: headingFont,
              fontWeight: 900,
              fontSize: common.scale(18),
              letterSpacing: 1,
              textTransform: 'uppercase',
              color: ink,
            }}
          >
            NOTHING IN LINE
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
              const cardTilt = ALTERNATING_TILTS[index % ALTERNATING_TILTS.length];

              const animation =
                phase === 'entering' && !reducedMotion
                  ? `brutalist-slap-in ${enterDuration}ms steps(1, end) ${stagger * index}ms 1 both`
                  : undefined;

              return (
                <li
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: 12,
                    backgroundColor: isDonation ? accentColor : '#ffffff',
                    border: `${borderWidth}px solid ${ink}`,
                    boxShadow: `${Math.max(4, shadowOffset - 4)}px ${Math.max(4, shadowOffset - 4)}px 0 #000`,
                    transform: reducedMotion ? undefined : `rotate(${cardTilt}deg)`,
                    transformOrigin: 'center center',
                    animation,
                  }}
                >
                  {/* Big number prefix */}
                  <span
                    style={{
                      flexShrink: 0,
                      fontFamily: headingFont,
                      fontWeight: 900,
                      fontSize: common.scale(38),
                      lineHeight: 0.9,
                      letterSpacing: -2,
                      color: ink,
                      minWidth: 48,
                    }}
                  >
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: headingFont,
                        fontWeight: 900,
                        fontSize: common.scale(18),
                        letterSpacing: -0.3,
                        textTransform: 'uppercase',
                        color: ink,
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
                        fontWeight: 700,
                        fontSize: common.scale(14),
                        letterSpacing: 0.5,
                        textTransform: 'uppercase',
                        color: ink,
                        opacity: 0.8,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        marginTop: 2,
                      }}
                    >
                      {getArtist(item)}
                      {data.settings?.showRequesterName !== false && item.requesterNickname ? (
                        <span style={{ opacity: 0.7 }}> · @{item.requesterNickname}</span>
                      ) : null}
                    </div>
                  </div>
                  {isDonation && (
                    <span
                      style={{
                        flexShrink: 0,
                        fontFamily: headingFont,
                        fontWeight: 900,
                        fontSize: common.scale(13),
                        letterSpacing: 1,
                        backgroundColor: ink,
                        color: accentColor,
                        padding: '3px 7px',
                        border: `2px solid ${ink}`,
                        transform: 'rotate(3deg)',
                      }}
                    >
                      $$$
                    </span>
                  )}
                  {isHomework && (
                    <span
                      style={{
                        flexShrink: 0,
                        fontFamily: headingFont,
                        fontWeight: 900,
                        fontSize: common.scale(13),
                        letterSpacing: 1,
                        backgroundColor: accentColor,
                        color: ink,
                        padding: '3px 7px',
                        border: `2px solid ${ink}`,
                        transform: 'rotate(-3deg)',
                      }}
                    >
                      HW
                    </span>
                  )}

                  {isRandom && (
                    <span
                      style={{
                        flexShrink: 0,
                        fontFamily: headingFont,
                        fontWeight: 900,
                        fontSize: common.scale(13),
                        letterSpacing: 1,
                        backgroundColor: accentColor,
                        color: ink,
                        padding: '3px 7px',
                        border: `2px solid ${ink}`,
                        transform: 'rotate(-3deg)',
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
