'use client';

import { useMemo, memo} from 'react';
import type { ThemeWidgetProps } from '../types';
import { buildFontFamilyValue, useCommonOptions, useTrackTransition } from '../shared';
import { buildBlurFilter } from '../shared/apply-transparency';
import { defaultOptions, type ThreeDDepthOptions } from './config';
import type { SongRequest } from '../../types/overlay';
import { shouldShowPlaybackProgress, formatTime } from '../../components/now-playing/types';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): ThreeDDepthOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<ThreeDDepthOptions>),
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

/** Convert "#rrggbb" to "r, g, b" for use in rgba() strings. */
function hexToRgbTriplet(hex: string, fallback = '30, 41, 59'): string {
  const match = hex.trim().match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!match) return fallback;
  const r = parseInt(match[1], 16);
  const g = parseInt(match[2], 16);
  const b = parseInt(match[3], 16);
  return `${r}, ${g}, ${b}`;
}

/**
 * Shift an rgb triplet toward white by `amount` (0..1). Used to generate the
 * second stop of the card's linear-gradient background so the top of the card
 * reads slightly lighter than the base — sells the "light from above" read.
 */
function lighten(rgbTriplet: string, amount: number): string {
  const [r, g, b] = rgbTriplet.split(',').map((p) => parseInt(p.trim(), 10));
  const lift = (v: number) => Math.round(v + (255 - v) * amount);
  return `${lift(r)}, ${lift(g)}, ${lift(b)}`;
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
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['Poppins', 'sans-serif']),
    [common.fontFamily, fonts.roles.body],
  );
  const accentFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.accent ?? ['Outfit', 'sans-serif']),
    [common.fontFamily, fonts.roles.accent],
  );

  const currentTrack = buildDisplayTrack(data?.nowPlaying ?? null);

  const { displayTrack, className: transitionClassName } = useTrackTransition({
    currentTrack,
    trackKey: currentTrack?.id ?? null,
    animation: animations['track.change'],
    reducedMotion,
    themeId: '3d-depth',
    isSameTrack: (a, b) => a?.id === b?.id,
  });

  const showProgress = shouldShowPlaybackProgress(
    playbackProgress ?? { currentTime: 0, duration: 0, state: 'unstarted', percentage: 0 },
  );
  const progressPercent = showProgress && playbackProgress
    ? Math.round(Math.min(100, Math.max(0, playbackProgress.percentage)))
    : 0;

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

  // Multi-layer box-shadow for 3D depth. `shadowDepth` scales all layers.
  const shadowScale = shadowDepth / 20;
  const cardShadow = [
    `${Math.round(25 * shadowScale)}px ${Math.round(25 * shadowScale)}px ${Math.round(60 * shadowScale)}px rgba(0, 0, 0, 0.5)`,
    `-${Math.round(4 * shadowScale)}px -${Math.round(4 * shadowScale)}px ${Math.round(15 * shadowScale)}px rgba(255, 255, 255, 0.02)`,
    `0 0 ${Math.round(30 * shadowScale)}px rgba(${accentRgb}, 0.08)`,
  ].join(', ');

  const containerStyle: React.CSSProperties = useMemo(() => ({
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: bodyFont,
    fontWeight: common.fontWeight,
    color: textColor,
    background: 'transparent',
    // Parent provides the perspective — children transforms then feel 3D.
    perspective: `${perspective}px`,
    perspectiveOrigin: '50% 40%',
    position: 'relative',
    overflow: 'visible',
    padding: 16,
  }), [bodyFont, common.textSizeMultiplier, common.fontWeight, textColor, perspective]);

  const cardStyle: React.CSSProperties = useMemo(() => {
    const rgb = hexToRgbTriplet(baseColor, '30, 41, 59');
    const lighter = lighten(rgb, 0.14);
    return {
      position: 'relative',
      flex: 1,
      width: '100%',
      padding: '22px 24px',
      borderRadius: 18,
      background: `linear-gradient(135deg, rgba(${lighter}, ${common.backgroundOpacity}) 0%, rgba(${rgb}, ${common.backgroundOpacity}) 100%)`,
      border: `1px solid rgba(255, 255, 255, ${0.05 * common.borderOpacity})`,
      display: 'flex',
      gap: 18,
      alignItems: 'center',
      transform: `rotateY(${rotateY}deg) rotateX(${rotateX}deg)`,
      transformStyle: 'preserve-3d',
      transformOrigin: 'center center',
      willChange: 'transform',
      backdropFilter: buildBlurFilter(common.blurIntensity),
      WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
    };
  }, [baseColor, rotateY, rotateX, common.backgroundOpacity, common.borderOpacity, common.blurIntensity]);

  // === Idle state ===
  const idleCardStyle: React.CSSProperties = useMemo(() => ({
    ...cardStyle,
    justifyContent: 'center',
    textAlign: 'center',
    minHeight: 120,
    animation: reducedMotion ? undefined : 'depth3d-float 4s ease-in-out infinite',
  }), [cardStyle, reducedMotion]);

  if (!displayTrack) {
    return (
      <div style={containerStyle}>
        <div style={idleCardStyle}>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontFamily: accentFont,
                fontSize: common.scale(14),
                letterSpacing: 3,
                textTransform: 'uppercase',
                color: highlightColor,
                opacity: 0.7,
                marginBottom: 8,
              }}
            >
              Now Playing
            </div>
            <div
              style={{
                fontFamily: headingFont,
                fontSize: common.scale(20),
                fontWeight: 500,
                color: textColor,
                opacity: 0.6,
              }}
            >
              Waiting for a song...
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div className={transitionClassName} style={cardStyle}>
        {/* Album art with its own 3D shadow + tiny counter-tilt */}
        <div
          style={{
            flexShrink: 0,
            width: 84,
            height: 84,
            borderRadius: 14,
            overflow: 'hidden',
            backgroundColor: `rgba(${baseRgb}, 0.6)`,
            border: `1px solid rgba(255, 255, 255, 0.08)`,
            boxShadow: `
              12px 12px 30px rgba(0, 0, 0, 0.55),
              -2px -2px 8px rgba(255, 255, 255, 0.04),
              inset 0 0 12px rgba(0, 0, 0, 0.4)
            `,
            transform: 'rotateY(-4deg)',
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
                filter: 'saturate(1.05) contrast(1.03)',
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
                fontFamily: headingFont,
                fontSize: common.scale(30),
                opacity: 0.75,
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
              marginBottom: 3,
            }}
          >
            <div
              style={{
                fontFamily: accentFont,
                fontSize: common.scale(14),
                letterSpacing: 2,
                textTransform: 'uppercase',
                color: highlightColor,
                opacity: 0.75,
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
                  padding: '2px 7px',
                  borderRadius: 999,
                  background: `linear-gradient(135deg, ${accentColor}, ${highlightColor})`,
                  color: '#ffffff',
                  textTransform: 'uppercase',
                  boxShadow: `0 4px 12px rgba(${accentRgb}, 0.4)`,
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
                  padding: '2px 7px',
                  borderRadius: 999,
                  backgroundColor: `rgba(${accentRgb}, 0.22)`,
                  border: `1px solid rgba(${accentRgb}, 0.45)`,
                  color: highlightColor,
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
                  padding: '2px 7px',
                  borderRadius: 999,
                  backgroundColor: `rgba(${accentRgb}, 0.22)`,
                  border: `1px solid rgba(${accentRgb}, 0.45)`,
                  color: highlightColor,
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
              fontSize: common.scale(26),
              fontWeight: 700,
              margin: 0,
              lineHeight: 1.3,
              color: textColor,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              textShadow: '0 2px 6px rgba(0, 0, 0, 0.4)',
            }}
          >
            {displayTrack.title}
          </h3>
          <p
            style={{
              fontFamily: bodyFont,
              fontSize: common.scale(19),
              fontWeight: 400,
              margin: '2px 0 0 0',
              color: highlightColor,
              opacity: 0.7,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {displayTrack.artist}
            {data.settings?.showRequesterName !== false && displayTrack.requesterNickname ? (
              <span style={{ opacity: 0.7 }}> · @{displayTrack.requesterNickname}</span>
            ) : null}
          </p>

          {showProgress && playbackProgress && (
            <div style={{ marginTop: 12 }}>
              <div
                style={{
                  position: 'relative',
                  width: '100%',
                  height: 4,
                  borderRadius: 999,
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  overflow: 'hidden',
                  boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.5)',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    height: '100%',
                    width: `${progressPercent}%`,
                    background: `linear-gradient(90deg, ${accentColor}, ${highlightColor})`,
                    borderRadius: 999,
                    transition: reducedMotion ? 'none' : 'width 1s linear',
                    boxShadow: `0 0 12px rgba(${accentRgb}, 0.55)`,
                  }}
                />
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: 5,
                  fontFamily: accentFont,
                  fontSize: common.scale(14),
                  color: textColor,
                  opacity: 0.45,
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
  );
}
NowPlaying.displayName = 'NowPlaying';
export default memo(NowPlaying);
