'use client';

import { useMemo, memo} from 'react';
import type { ThemeWidgetProps } from '../types';
import { buildFontFamilyValue, useCommonOptions, useTrackTransition } from '../shared';
import { defaultOptions, type GlassmorphismOptions } from './config';
import LiquidGlassFilter from './LiquidGlassFilter';
import type { SongRequest } from '../../types/overlay';
import { shouldShowPlaybackProgress, formatTime } from '../../components/now-playing/types';

const LIQUID_FILTER_ID = 'liquid-glass-nowplaying';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): GlassmorphismOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<GlassmorphismOptions>),
  };
}

interface DisplayTrack {
  id: number | string;
  title: string;
  artist: string;
  albumArt?: string;
  isDonation: boolean;
  isHomework: boolean;
  isRandom: boolean;
  requesterNickname?: string;
}

function buildDisplayTrack(now: SongRequest | null | undefined): DisplayTrack | null {
  if (!now) return null;
  return {
    id: now.id,
    title: now.song?.title || now.rawTitle || 'Unknown Title',
    artist: now.song?.artist?.name || now.rawArtist || 'Unknown Artist',
    albumArt: now.song?.albumArt,
    isDonation: (now.donationAmount ?? 0) > 0,
    isHomework: !!now.isHomework,

    isRandom: !!now.isRandom,
    requesterNickname: now.requesterNickname || undefined,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function NowPlaying({
  data,
  options: rawOptions,
  animations,
  fonts,
  reducedMotion,
  playbackProgress,
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

  const currentTrack = buildDisplayTrack(data?.nowPlaying ?? null);

  const { displayTrack, className: transitionClassName } = useTrackTransition({
    currentTrack,
    trackKey: currentTrack?.id ?? null,
    animation: animations['track.change'],
    reducedMotion,
    themeId: 'glassmorphism',
    isSameTrack: (a, b) => a?.id === b?.id,
  });

  const showProgress = shouldShowPlaybackProgress(
    playbackProgress ?? { currentTime: 0, duration: 0, state: 'unstarted', percentage: 0 },
  );
  const progressPercent = showProgress && playbackProgress
    ? Math.round(Math.min(100, Math.max(0, playbackProgress.percentage)))
    : 0;

  const cardOpacity = clamp(options.cardOpacity, 0, 100) / 100;
  const textColor = common.textColor ?? options.textColor ?? '#ffffff';
  const accentColor = common.accentColor ?? textColor;
  const gradientStart = options.gradientStart || '#667eea';
  const gradientEnd = options.gradientEnd || '#764ba2';

  // iOS-26 Liquid Glass knobs (0.1–0.6 opacity, 8–40px blur).
  const glassOpacity = clamp(options.glassOpacity ?? 0.28, 0.1, 0.6);
  const glassBlur = clamp(options.glassBlur ?? 20, 8, 40);

  // Common transparency controls — blurIntensity & borderOpacity come from
  // useCommonOptions (no longer theme-specific).
  const blurPx = common.blurIntensity;
  const borderOpacity = common.borderOpacity;

  // cardBorder is still referenced inline below (album-art border) so keep
  // the derived value but only for that. The frame style derives locally.
  const cardBorder = `rgba(255, 255, 255, ${borderOpacity * 0.5})`;

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

  // iOS-26 Liquid Glass card. The url() piece references the inline SVG
  // filter; Chromium (OBS runtime) runs the feDisplacementMap refraction,
  // other engines silently drop the url() and keep blur+saturate.
  const cardStyle: React.CSSProperties = useMemo(() => {
    const effectiveGlassOpacity = glassOpacity * common.backgroundOpacity;
    const liquidFilter = `url(#${LIQUID_FILTER_ID}) blur(${glassBlur}px) saturate(180%)`;
    const fallbackFilter = `blur(${blurPx}px) saturate(180%)`;
    return {
      position: 'relative',
      flex: 1,
      width: '100%',
      padding: 20,
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
      display: 'flex',
      gap: 16,
      alignItems: 'center',
      overflow: 'hidden',
    };
  }, [glassBlur, glassOpacity, blurPx, borderOpacity, common.backgroundOpacity]);

  // Specular highlight: top-left light source + bottom-right soft reflection.
  // Sits above the card background but below the content (z-index 0 vs 1).
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
    gap: 16,
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  }), []);

  // === Idle state ===
  if (!displayTrack) {
    return (
      <div style={containerStyle}>
        <LiquidGlassFilter id={LIQUID_FILTER_ID} />
        <div style={{ ...cardStyle, justifyContent: 'center', textAlign: 'center' }}>
          <div aria-hidden style={specularStyle} />
          <div style={{ ...contentLayerStyle, justifyContent: 'center' }}>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontFamily: accentFont,
                  fontSize: common.scale(15),
                  letterSpacing: 2,
                  textTransform: 'uppercase',
                  opacity: 0.75,
                  marginBottom: 6,
                  color: accentColor,
                }}
              >
                Now Playing
              </div>
              <div
                style={{
                  fontFamily: headingFont,
                  fontSize: common.scale(20),
                  fontWeight: 500,
                  opacity: 0.7,
                }}
              >
                Waiting for a song...
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <LiquidGlassFilter id={LIQUID_FILTER_ID} />
      <div className={transitionClassName} style={cardStyle}>
        <div aria-hidden style={specularStyle} />
        <div style={contentLayerStyle}>
        {/* Album art */}
        <div
          style={{
            flexShrink: 0,
            width: 72,
            height: 72,
            borderRadius: 14,
            overflow: 'hidden',
            backgroundColor: 'rgba(255, 255, 255, 0.08)',
            border: `1px solid ${cardBorder}`,
            boxShadow: '0 6px 20px rgba(0, 0, 0, 0.25)',
            position: 'relative',
          }}
        >
          {displayTrack.albumArt ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={displayTrack.albumArt}
              alt={displayTrack.title}
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
                opacity: 0.6,
                fontFamily: headingFont,
                fontSize: common.scale(28),
              }}
            >
              {'\u266B'}
            </div>
          )}
        </div>

        {/* Title + artist + progress */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 2,
            }}
          >
            <div
              style={{
                fontFamily: accentFont,
                fontSize: common.scale(15),
                letterSpacing: 1.5,
                textTransform: 'uppercase',
                opacity: 0.7,
                color: accentColor,
              }}
            >
              Now Playing
            </div>
            {displayTrack.isDonation && (
              <span
                style={{
                  fontFamily: accentFont,
                  fontSize: common.scale(10),
                  letterSpacing: 1,
                  padding: '2px 6px',
                  borderRadius: 999,
                  backgroundColor: 'rgba(255, 255, 255, 0.22)',
                  border: `1px solid rgba(255, 255, 255, 0.35)`,
                  textTransform: 'uppercase',
                }}
              >
                Donation
              </span>
            )}
            {displayTrack.isHomework && (
              <span
                style={{
                  fontFamily: accentFont,
                  fontSize: common.scale(10),
                  letterSpacing: 1,
                  padding: '2px 6px',
                  borderRadius: 999,
                  backgroundColor: 'rgba(255, 255, 255, 0.14)',
                  border: `1px solid rgba(255, 255, 255, 0.28)`,
                  textTransform: 'uppercase',
                }}
              >
                HW
              </span>
            )}

            {displayTrack.isRandom && (
              <span
                style={{
                  fontFamily: accentFont,
                  fontSize: common.scale(10),
                  letterSpacing: 1,
                  padding: '2px 6px',
                  borderRadius: 999,
                  backgroundColor: 'rgba(255, 255, 255, 0.14)',
                  border: `1px solid rgba(255, 255, 255, 0.28)`,
                  textTransform: 'uppercase',
                }}
              >
                RND
              </span>
            )}
          </div>
          <h3
            style={{
              fontFamily: headingFont,
              fontSize: common.scale(30),
              fontWeight: 700,
              margin: 0,
              lineHeight: 1.3,
              color: textColor,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {displayTrack.title}
          </h3>
          <p
            style={{
              fontFamily: bodyFont,
              fontSize: common.scale(22),
              margin: '2px 0 0 0',
              color: textColor,
              opacity: 0.7,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {displayTrack.artist}
            {data.settings?.showRequesterName !== false && displayTrack.requesterNickname ? (
              <span style={{ opacity: 0.8 }}> · @{displayTrack.requesterNickname}</span>
            ) : null}
          </p>

          {showProgress && playbackProgress && (
            <div style={{ marginTop: 10 }}>
              <div
                style={{
                  position: 'relative',
                  width: '100%',
                  height: 3,
                  borderRadius: 999,
                  backgroundColor: 'rgba(255, 255, 255, 0.18)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    height: '100%',
                    width: `${progressPercent}%`,
                    background: `linear-gradient(90deg, ${textColor}, rgba(255, 255, 255, 0.65))`,
                    borderRadius: 999,
                    transition: reducedMotion ? 'none' : 'width 1s linear',
                    boxShadow: '0 0 10px rgba(255, 255, 255, 0.45)',
                  }}
                />
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: 4,
                  fontFamily: accentFont,
                  fontSize: common.scale(14),
                  color: textColor,
                  opacity: 0.4,
                  letterSpacing: 0.5,
                }}
              >
                <span>{formatTime(playbackProgress.currentTime)}</span>
                <span>{formatTime(playbackProgress.duration)}</span>
              </div>
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
NowPlaying.displayName = 'NowPlaying';
export default memo(NowPlaying);
