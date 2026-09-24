'use client';

import { memo, useMemo } from 'react';
import type { ThemeWidgetProps } from '../types';
import {
  buildFontFamilyValue,
  useCommonOptions,
  useQueueAnimation,
} from '../shared';
import { hexToRgba, withOpacity, buildBlurFilter } from '../shared/apply-transparency';
import { defaultOptions, type SportsTickerOptions } from './config';
import type { SongRequest } from '../../types/overlay';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): SportsTickerOptions {
  return { ...defaultOptions, ...(raw as Partial<SportsTickerOptions>) };
}

function getTitle(item: SongRequest): string {
  return item.song?.title || item.rawTitle || 'UNKNOWN';
}

function getArtist(item: SongRequest): string {
  return item.song?.artist?.name || item.rawArtist || '';
}

function getRequester(item: SongRequest): string {
  return item.requesterNickname || 'ANON';
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
      buildFontFamilyValue(fonts.roles.heading ?? ['Inter', 'sans-serif']),
    [common.fontFamily, fonts.roles.heading],
  );
  const bodyFont = useMemo(
    () =>
      common.fontFamily ??
      buildFontFamilyValue(
        fonts.roles.body ?? ['Roboto Condensed', 'sans-serif'],
      ),
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

  const brandColor = options.brandColor || common.accentColor || "#c0392b";
  const accentColor = options.accentColor;
  const textColor = common.textColor ?? options.textColor;
  const bgColor = options.backgroundColor;

  const enterDuration = animations['queue.add']?.enterDuration ?? 450;
  const exitDuration = animations['queue.remove']?.enterDuration ?? 300;
  const stagger = animations['queue.add']?.stagger ?? 80;

  const totalQueue = queue.length;

  const containerStyle: React.CSSProperties = useMemo(
    () => ({
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: hexToRgba(bgColor, common.backgroundOpacity),
      border: `2px solid ${withOpacity(brandColor, common.borderOpacity)}`,
      fontFamily: bodyFont,
      fontWeight: common.fontWeight,
      color: textColor,
      overflow: 'hidden',
      pointerEvents: 'none',
      backdropFilter: buildBlurFilter(common.blurIntensity),
      WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
    }),
    [
      bgColor,
      bodyFont,
      brandColor,
      common.backgroundOpacity,
      common.blurIntensity,
      common.borderOpacity,
      common.fontWeight,
      textColor,
    ],
  );

  return (
    <div style={containerStyle}>
      {/* Header bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 14px',
          background: brandColor,
          color: textColor,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: headingFont,
            fontWeight: 900,
            fontSize: common.scale(12),
            letterSpacing: '0.25em',
            textTransform: 'uppercase',
            paddingRight: 12,
            borderRight: `1px solid ${hexToRgba(textColor, 0.33)}`,
          }}
        >
          ▣ QUEUE
        </span>
        <span
          style={{
            fontFamily: headingFont,
            fontWeight: 700,
            fontSize: common.scale(12),
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            opacity: 0.85,
          }}
        >
          신청 곡 대기
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontFamily: headingFont,
            fontWeight: 900,
            fontSize: common.scale(14),
            letterSpacing: '0.15em',
            padding: '3px 10px',
            background: '#000',
            color: textColor,
          }}
        >
          × {String(totalQueue).padStart(2, '0')}
        </span>
      </div>

      {/* Body */}
      {totalQueue === 0 ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: headingFont,
            fontWeight: 900,
            fontSize: common.scale(13),
            letterSpacing: '0.4em',
            opacity: 0.5,
            textTransform: 'uppercase',
            padding: 16,
            textAlign: 'center',
          }}
        >
          -- AWAITING REQUESTS --
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
            }}
          >
            {animatedItems.map(({ item, phase, index }) => {
              const isDonation = (item.donationAmount ?? 0) > 0;
              const isHomework = !!item.isHomework;

              const isRandom = !!item.isRandom;

              const animationCss =
                phase === 'entering' && !reducedMotion
                  ? `sports-ticker-banner-slide ${enterDuration}ms cubic-bezier(0.22, 1, 0.36, 1) ${stagger * index}ms 1 both`
                  : phase === 'exiting' && !reducedMotion
                    ? `sports-ticker-banner-slide-out ${exitDuration}ms ease-in 0ms 1 both`
                    : undefined;

              return (
                <li
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 14px',
                    borderBottom: `1px solid ${hexToRgba(textColor, 0.13)}`,
                    background: isDonation
                      ? hexToRgba(brandColor, 0.2)
                      : index % 2 === 0
                        ? 'transparent'
                        : hexToRgba(textColor, 0.025),
                    animation: animationCss,
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      fontFamily: headingFont,
                      fontWeight: 900,
                      fontSize: common.scale(13),
                      letterSpacing: '0.1em',
                      color: isDonation ? '#000' : textColor,
                      background: isDonation
                        ? brandColor
                        : hexToRgba(accentColor, 0.8),
                      padding: '4px 9px',
                      minWidth: 38,
                      textAlign: 'center',
                      border: `1px solid ${
                        isDonation
                          ? brandColor
                          : hexToRgba(textColor, 0.2)
                      }`,
                    }}
                  >
                    #{String(index + 1).padStart(2, '0')}
                  </span>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: headingFont,
                        fontWeight: 800,
                        fontSize: common.scale(16),
                        lineHeight: 1.15,
                        color: textColor,
                        textTransform: 'uppercase',
                        letterSpacing: '-0.005em',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {getTitle(item)}
                    </div>
                    <div
                      style={{
                        marginTop: 2,
                        fontFamily: bodyFont,
                        fontWeight: 600,
                        fontSize: common.scale(12),
                        lineHeight: 1.2,
                        color: textColor,
                        opacity: 0.7,
                        letterSpacing: '0.05em',
                        textTransform: 'uppercase',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {getArtist(item)}
                      {item.requesterNickname ? (
                        <span style={{ opacity: 0.7 }}>
                          {'  ·  @'}
                          {getRequester(item)}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {isDonation && (
                    <span
                      style={{
                        flexShrink: 0,
                        fontFamily: headingFont,
                        fontWeight: 900,
                        fontSize: common.scale(11),
                        letterSpacing: '0.18em',
                        color: textColor,
                        background: brandColor,
                        padding: '3px 9px',
                        textTransform: 'uppercase',
                      }}
                    >
                      $$$
                      {item.formattedPrice
                        ? ` ${item.formattedPrice}`
                        : item.donationAmount
                          ? ` ${item.donationAmount.toLocaleString('ko-KR')}`
                          : ''}
                    </span>
                  )}
                  {isHomework && !isDonation && (
                    <span
                      style={{
                        flexShrink: 0,
                        fontFamily: headingFont,
                        fontWeight: 900,
                        fontSize: common.scale(11),
                        letterSpacing: '0.18em',
                        color: textColor,
                        background: accentColor,
                        padding: '3px 9px',
                        border: `1px solid ${hexToRgba(textColor, 0.33)}`,
                        textTransform: 'uppercase',
                      }}
                    >
                      HW
                    </span>
                  )}
                  {isRandom && !isDonation && (
                    <span
                      style={{
                        flexShrink: 0,
                        fontFamily: headingFont,
                        fontWeight: 900,
                        fontSize: common.scale(11),
                        letterSpacing: '0.18em',
                        color: textColor,
                        background: accentColor,
                        padding: '3px 9px',
                        border: `1px solid ${hexToRgba(textColor, 0.33)}`,
                        textTransform: 'uppercase',
                      }}
                    >
                      RND
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Footer bar */}
      <div
        style={{
          padding: '5px 14px',
          background: brandColor,
          color: textColor,
          fontFamily: headingFont,
          fontWeight: 900,
          fontSize: common.scale(10),
          letterSpacing: '0.4em',
          textTransform: 'uppercase',
          textAlign: 'center',
          flexShrink: 0,
        }}
      >
        MELOMING.COM · ON AIR
      </div>
    </div>
  );
}

Queue.displayName = 'Queue';
export default memo(Queue);
