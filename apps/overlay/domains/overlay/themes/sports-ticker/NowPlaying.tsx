'use client';

import { memo, useMemo } from 'react';
import type { ThemeWidgetProps } from '../types';
import {
  buildFontFamilyValue,
  useCommonOptions,
  useTrackTransition,
} from '../shared';
import { hexToRgba, withOpacity, buildBlurFilter } from '../shared/apply-transparency';
import { defaultOptions, type SportsTickerOptions } from './config';
import type { SongRequest } from '../../types/overlay';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): SportsTickerOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<SportsTickerOptions>),
  };
}

interface DisplayTrack {
  id: number | string;
  title: string;
  artist: string;
  isDonation: boolean;
  isHomework: boolean;
  isRandom: boolean;
  albumArt?: string;
}

function buildDisplayTrack(
  now: SongRequest | null | undefined,
): DisplayTrack | null {
  if (!now) return null;
  return {
    id: now.id,
    title: now.song?.title || now.rawTitle || 'NO TRACK ON AIR',
    artist: now.song?.artist?.name || now.rawArtist || '',
    isDonation: (now.donationAmount ?? 0) > 0,
    isHomework: !!now.isHomework,

    isRandom: !!now.isRandom,
    albumArt: now.song?.albumArt,
  };
}

function clampNumber(
  value: number,
  min: number,
  max: number,
  fallback: number,
): number {
  if (Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, value));
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

  const currentTrack = buildDisplayTrack(data?.nowPlaying ?? null);

  const { displayTrack, className: transitionClassName } = useTrackTransition({
    currentTrack,
    trackKey: currentTrack?.id ?? null,
    animation: animations['track.change'],
    reducedMotion,
    themeId: 'sports-ticker',
    isSameTrack: (a, b) => a?.id === b?.id,
  });

  const nextUp = useMemo(() => {
    const queue = data?.queue ?? [];
    const head = queue[0];
    if (!head) return null;
    return {
      title: head.song?.title || head.rawTitle || 'UNKNOWN',
      artist: head.song?.artist?.name || head.rawArtist || '',
    };
  }, [data?.queue]);

  const tickerText = displayTrack
    ? `NOW PLAYING: ${displayTrack.title} - ${displayTrack.artist}${
        nextUp ? `   |   NEXT UP: ${nextUp.title} - ${nextUp.artist}` : ''
      }   |   `
    : 'STANDBY   |   AWAITING SIGNAL   |   ';

  const brandColor = options.brandColor || common.accentColor || "#c0392b";
  const accentColor = options.accentColor;
  const textColor = common.textColor ?? options.textColor;
  const liveBlinkSpeed = clampNumber(options.liveBlinkSpeed, 0.5, 3, 1.5);
  const tickerSpeed = clampNumber(options.tickerSpeed, 6, 30, 14);
  const showLive = options.showLiveIndicator !== false;

  const containerStyle: React.CSSProperties = useMemo(
    () => ({
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-end',
      background: 'transparent',
      fontFamily: bodyFont,
      fontWeight: common.fontWeight,
      color: textColor,
      overflow: 'hidden',
      position: 'relative',
      backdropFilter: buildBlurFilter(common.blurIntensity),
      WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
    }),
    [bodyFont, common.fontWeight, common.blurIntensity, textColor],
  );

  const topSectionStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'stretch',
    backgroundColor: hexToRgba(
      options.backgroundColor,
      common.backgroundOpacity * 0.92,
    ),
    borderTop: `4px solid ${withOpacity(brandColor, common.borderOpacity)}`,
    borderBottom: `4px solid ${withOpacity(brandColor, common.borderOpacity)}`,
  };

  const bottomBarStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'stretch',
    width: '100%',
    height: 52,
    flexShrink: 0,
  };

  return (
    <div style={containerStyle}>
      {/* Top — brand-color side strip + album art + title/artist */}
      <div className={transitionClassName} style={topSectionStyle}>
        {/* Big brand-color side strip — like a broadcast lower-third
            "category" tag. Was missing in the previous build, so the
            theme didn't read as "sports / news" anymore. */}
        <div
          style={{
            flexShrink: 0,
            width: 88,
            background: brandColor,
            color: textColor,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            padding: '12px 8px',
            position: 'relative',
          }}
        >
          <span
            style={{
              fontFamily: headingFont,
              fontWeight: 900,
              fontSize: common.scale(11),
              letterSpacing: '0.32em',
              textTransform: 'uppercase',
              opacity: 0.85,
            }}
          >
            ON AIR
          </span>
          <span
            style={{
              fontFamily: headingFont,
              fontWeight: 900,
              fontSize: common.scale(28),
              letterSpacing: '-0.02em',
              lineHeight: 1,
              textTransform: 'uppercase',
            }}
          >
            ▶
          </span>
          <span
            style={{
              fontFamily: headingFont,
              fontWeight: 900,
              fontSize: common.scale(10),
              letterSpacing: '0.28em',
              textTransform: 'uppercase',
              opacity: 0.75,
            }}
          >
            LIVE
          </span>
        </div>

        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            padding: '18px 22px',
            minWidth: 0,
          }}
        >
        <div
          style={{
            flexShrink: 0,
            width: 84,
            height: 84,
            backgroundColor: '#000',
            border: `3px solid ${brandColor}`,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {displayTrack?.albumArt ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={displayTrack.albumArt}
              alt={displayTrack.title}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
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
                color: brandColor,
                fontSize: common.scale(28),
                fontWeight: 900,
              }}
            >
              {'♫'}
            </div>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: headingFont,
              fontWeight: 800,
              fontSize: `clamp(${common.scale(34)}px, ${common.scale(3.8)}vw, ${common.scale(56)}px)`,
              lineHeight: 1.05,
              color: textColor,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              textTransform: 'uppercase',
              letterSpacing: '-0.005em',
            }}
          >
            {displayTrack?.title ?? 'NO TRACK ON AIR'}
          </div>
          <div
            style={{
              fontFamily: bodyFont,
              fontWeight: 600,
              fontSize: `clamp(${common.scale(18)}px, ${common.scale(1.9)}vw, ${common.scale(28)}px)`,
              lineHeight: 1.2,
              color: textColor,
              opacity: 0.78,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginTop: 6,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            {displayTrack?.artist ?? 'STANDBY MODE'}
          </div>
        </div>

        {displayTrack?.isDonation && (
          <span
            style={{
              flexShrink: 0,
              fontFamily: headingFont,
              fontWeight: 900,
              fontSize: common.scale(13),
              letterSpacing: 1.5,
              color: textColor,
              backgroundColor: brandColor,
              padding: '5px 10px',
            }}
          >
            DONATION
          </span>
        )}
        {displayTrack?.isHomework && (
          <span
            style={{
              flexShrink: 0,
              fontFamily: headingFont,
              fontWeight: 900,
              fontSize: common.scale(13),
              letterSpacing: 1.5,
              color: textColor,
              backgroundColor: accentColor,
              padding: '5px 10px',
            }}
          >
            HW
          </span>
        )}
        </div>
      </div>

      {/* Bottom ticker bar */}
      <div style={bottomBarStyle}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            paddingLeft: 12,
            paddingRight: 14,
            backgroundColor: brandColor,
            color: textColor,
            flexShrink: 0,
          }}
        >
          {showLive && (
            <span
              style={{
                display: 'inline-block',
                fontFamily: headingFont,
                fontWeight: 900,
                fontSize: common.scale(14),
                letterSpacing: 2,
                color: brandColor,
                backgroundColor: textColor,
                padding: '5px 10px',
                animation: reducedMotion
                  ? undefined
                  : `sports-ticker-live-blink ${liveBlinkSpeed}s ease-in-out infinite`,
              }}
            >
              LIVE
            </span>
          )}
          <span
            style={{
              fontFamily: headingFont,
              fontWeight: 900,
              fontSize: common.scale(16),
              letterSpacing: 2,
              textTransform: 'uppercase',
            }}
          >
            NOW
          </span>
        </div>

        <div
          style={{
            flex: 1,
            minWidth: 0,
            backgroundColor: accentColor,
            color: textColor,
            display: 'flex',
            alignItems: 'center',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <div
            style={{
              display: 'flex',
              whiteSpace: 'nowrap',
              fontFamily: bodyFont,
              fontWeight: 800,
              fontSize: common.scale(18),
              letterSpacing: 1.5,
              textTransform: 'uppercase',
              willChange: 'transform',
              animation: reducedMotion
                ? undefined
                : `sports-ticker-scroll-loop ${tickerSpeed}s linear infinite`,
            }}
          >
            <span style={{ paddingRight: 48 }}>{tickerText}</span>
            <span style={{ paddingRight: 48 }} aria-hidden="true">
              {tickerText}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

NowPlaying.displayName = 'NowPlaying';
export default memo(NowPlaying);
