'use client';

import { Fragment, useMemo, memo} from 'react';
import type { ThemeWidgetProps } from '../types';
import { buildFontFamilyValue, useCommonOptions, useQueueAnimation } from '../shared';
import { hexToRgba, withOpacity, buildBlurFilter } from '../shared/apply-transparency';
import { defaultOptions, type KawaiiOptions } from './config';
import type { SongRequest } from '../../types/overlay';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): KawaiiOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<KawaiiOptions>),
  };
}

function clampRadius(value: number): number {
  if (Number.isNaN(value)) return 20;
  return Math.max(8, Math.min(32, value));
}

function getTitle(item: SongRequest): string {
  return item.song?.title || item.rawTitle || 'Unknown';
}

function getArtist(item: SongRequest): string {
  return item.song?.artist?.name || item.rawArtist || '';
}

function decorationGlyph(style: KawaiiOptions['decorationStyle']): string {
  switch (style) {
    case 'hearts':
      return '\u2665';
    case 'sparkles':
      return '\u2728';
    case 'stars':
    default:
      return '\u2605';
  }
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
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.heading ?? ['Fredoka', 'sans-serif']),
    [common.fontFamily, fonts.roles.heading],
  );
  const bodyFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['Comfortaa', 'sans-serif']),
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

  const mainColor = options.mainColor || '#ffb6d9';
  const accentColor = common.accentColor ?? options.accentColor ?? '#b088f9';
  const bgColor = options.backgroundColor || '#fff5fa';
  const textColor = common.textColor ?? options.textColor ?? '#d63384';
  const borderRadius = clampRadius(options.borderRadius);
  const deco = decorationGlyph(options.decorationStyle);

  const enterDuration = animations['queue.add']?.enterDuration ?? 450;
  const stagger = animations['queue.add']?.stagger ?? 80;

  const softShadow = `0 8px 24px rgba(255, 182, 217, 0.35), 0 2px 8px rgba(176, 136, 249, 0.2)`;

  const containerStyle: React.CSSProperties = useMemo(() => ({
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: bodyFont,
    fontWeight: common.fontWeight,
    color: textColor,
    background: 'transparent',
  }), [bodyFont, common.textSizeMultiplier, common.fontWeight, textColor]);

  const cardStyle: React.CSSProperties = useMemo(() => ({
    position: 'relative',
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    padding: 18,
    borderRadius,
    backgroundColor: hexToRgba(bgColor, common.backgroundOpacity),
    border: `3px solid ${withOpacity(mainColor, common.borderOpacity)}`,
    overflow: 'hidden',
    backdropFilter: buildBlurFilter(common.blurIntensity),
    WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
  }), [bgColor, borderRadius, mainColor, common.backgroundOpacity, common.borderOpacity, common.blurIntensity]);

  const headerStyle: React.CSSProperties = useMemo(() => ({
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  }), []);

  const underlineStyle: React.CSSProperties = useMemo(() => ({
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 4,
    background: `linear-gradient(90deg, ${mainColor}, ${accentColor})`,
    borderBottomLeftRadius: borderRadius,
    borderBottomRightRadius: borderRadius,
  }), [accentColor, borderRadius, mainColor]);

  const isEmpty = queue.length === 0;
  const totalQueue = (data?.queue ?? []).length;

  const itemRadius = Math.max(6, borderRadius - 6);

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={headerStyle}>
          <span
            aria-hidden="true"
            style={{
              fontSize: common.scale(14),
              color: accentColor,
            }}
          >
            {deco}
          </span>
          <div
            style={{
              fontFamily: headingFont,
              fontSize: common.scale(22),
              fontWeight: 700,
              color: textColor,
              letterSpacing: 0.3,
            }}
          >
            Up Next
          </div>
          <span
            aria-hidden="true"
            style={{
              fontSize: common.scale(14),
              color: mainColor,
            }}
          >
            {deco}
          </span>
          <span
            style={{
              marginLeft: 'auto',
              fontFamily: bodyFont,
              fontSize: common.scale(14),
              letterSpacing: 0.5,
              padding: '3px 10px',
              borderRadius: 999,
              background: `linear-gradient(90deg, ${mainColor}, ${accentColor})`,
              color: '#ffffff',
              fontWeight: 700,
              textTransform: 'uppercase',
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
              color: accentColor,
              border: `2px dashed ${mainColor}`,
              borderRadius: itemRadius,
              backgroundColor: `${mainColor}11`,
            }}
          >
            <div style={{ fontFamily: headingFont, fontWeight: 700, color: textColor }}>
              Queue is empty {'\u2665'}
            </div>
            <div style={{ marginTop: 4, fontSize: common.scale(12) }}>
              Waiting for a request {deco}
            </div>
          </div>
        ) : (
          <ul data-overlay-scroll
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
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
                  ? `kawaii-heart-slide ${enterDuration}ms cubic-bezier(0.68, -0.55, 0.27, 1.55) ${stagger * index}ms 1 both`
                  : undefined;

              return (
                <Fragment key={item.id}>
                  {index > 0 && (
                    <div
                      aria-hidden="true"
                      style={{
                        textAlign: 'center',
                        fontSize: common.scale(10),
                        color: `${accentColor}88`,
                        letterSpacing: 2,
                        userSelect: 'none',
                        marginTop: -4,
                        marginBottom: -4,
                      }}
                    >
                      {deco}
                    </div>
                  )}
                  <li
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                      padding: 12,
                      borderRadius: itemRadius,
                      backgroundColor: isDonation
                        ? `${mainColor}33`
                        : `${mainColor}14`,
                      border: `2px solid ${
                        isDonation ? accentColor : `${mainColor}66`
                      }`,
                      boxShadow: `0 2px 8px rgba(255, 182, 217, 0.25)`,
                      animation,
                    }}
                  >
                    {/* Index badge */}
                    <div
                      style={{
                        flexShrink: 0,
                        width: 32,
                        height: 32,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontFamily: headingFont,
                        fontSize: common.scale(13),
                        fontWeight: 700,
                        color: '#ffffff',
                        background: `linear-gradient(135deg, ${mainColor}, ${accentColor})`,
                      }}
                    >
                      {String(index + 1).padStart(2, '0')}
                    </div>

                    {/* Thumbnail */}
                    <div
                      style={{
                        flexShrink: 0,
                        width: 64,
                        height: 64,
                        borderRadius: Math.max(4, itemRadius - 4),
                        overflow: 'hidden',
                        backgroundColor: `${mainColor}22`,
                        border: `1.5px solid ${mainColor}`,
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
                            color: accentColor,
                            opacity: 0.75,
                            fontSize: common.scale(16),
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
                          fontSize: common.scale(22),
                          fontWeight: 700,
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
                          fontSize: common.scale(19),
                          marginTop: 2,
                          color: accentColor,
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

                    {isDonation && (
                      <span
                        style={{
                          flexShrink: 0,
                          fontFamily: headingFont,
                          fontSize: common.scale(11),
                          letterSpacing: 0.5,
                          padding: '3px 7px',
                          borderRadius: 999,
                          background: `linear-gradient(90deg, ${mainColor}, ${accentColor})`,
                          color: '#ffffff',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                        }}
                      >
                        {'\u2605'}
                      </span>
                    )}
                    {isHomework && (
                      <span
                        style={{
                          flexShrink: 0,
                          fontFamily: headingFont,
                          fontSize: common.scale(11),
                          letterSpacing: 0.5,
                          padding: '3px 7px',
                          borderRadius: 999,
                          backgroundColor: `${accentColor}33`,
                          color: accentColor,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          border: `1px solid ${accentColor}66`,
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
                          fontSize: common.scale(11),
                          letterSpacing: 0.5,
                          padding: '3px 7px',
                          borderRadius: 999,
                          backgroundColor: `${accentColor}33`,
                          color: accentColor,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          border: `1px solid ${accentColor}66`,
                        }}
                      >
                        HW
                      </span>
                    )}
                  </li>
                </Fragment>
              );
            })}
          </ul>
        )}

        <div aria-hidden="true" style={underlineStyle} />
      </div>
    </div>
  );
}
Queue.displayName = 'Queue';
export default memo(Queue);
