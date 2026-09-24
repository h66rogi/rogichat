'use client';

import { useMemo, memo} from 'react';
import type { ThemeWidgetProps } from '../types';
import { buildFontFamilyValue, useCommonOptions, useTrackTransition } from '../shared';
import { hexToRgba, buildBlurFilter } from '../shared/apply-transparency';
import { defaultOptions, type NeonCyberpunkOptions } from './config';
import type { SongRequest } from '../../types/overlay';
import { shouldShowPlaybackProgress, formatTime } from '../../components/now-playing/types';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): NeonCyberpunkOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<NeonCyberpunkOptions>),
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
    title: now.song?.title || now.rawTitle || 'UNKNOWN TITLE',
    artist: now.song?.artist?.name || now.rawArtist || 'UNKNOWN ARTIST',
    albumArt: now.song?.albumArt,
    isDonation: (now.donationAmount ?? 0) > 0,
    isHomework: !!now.isHomework,

    isRandom: !!now.isRandom,
    requesterNickname: now.requesterNickname || undefined,
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

  const currentTrack = buildDisplayTrack(data?.nowPlaying ?? null);

  const { displayTrack, className: transitionClassName } = useTrackTransition({
    currentTrack,
    trackKey: currentTrack?.id ?? null,
    animation: options.glitchOnTransition ? animations['track.change'] : undefined,
    reducedMotion,
    themeId: 'neon-cyberpunk',
    isSameTrack: (a, b) => a?.id === b?.id,
  });

  const showProgress = shouldShowPlaybackProgress(
    playbackProgress ?? { currentTime: 0, duration: 0, state: 'unstarted', percentage: 0 },
  );
  const progressPercent = showProgress && playbackProgress
    ? Math.round(Math.min(100, Math.max(0, playbackProgress.percentage)))
    : 0;

  const glow = clampGlow(options.glowIntensity);
  // glowScale: 0 to 100 maps roughly 0.2 to 1.1. Multiplies the base glow.
  const glowScale = 0.2 + (glow / 100) * 0.9;

  const primaryNeon = common.accentColor ?? options.primaryNeon ?? '#ff00ff';
  const secondaryNeon = common.textColor ?? options.secondaryNeon ?? '#00fff7';
  const accentNeon = options.accentNeon || '#7b2ff7';
  const bgColor = options.backgroundColor || '#05000a';

  const primaryRgb = hexToRgbTriplet(primaryNeon, '255, 0, 255');
  const secondaryRgb = hexToRgbTriplet(secondaryNeon, '0, 255, 247');
  const accentRgb = hexToRgbTriplet(accentNeon, '123, 47, 247');

  // Multi-layer text-shadow helpers. The three stacked glows mimic the
  // "soft halo then tight halo then hot core" look of real neon tubes.
  const buildNeonTextShadow = (rgbTriplet: string, scale: number) => {
    const inner = `0 0 ${10 * scale}px rgba(${rgbTriplet}, ${Math.min(1, 0.95 * scale)})`;
    const mid = `0 0 ${20 * scale}px rgba(${rgbTriplet}, ${Math.min(1, 0.75 * scale)})`;
    const outer = `0 0 ${40 * scale}px rgba(${rgbTriplet}, ${Math.min(1, 0.5 * scale)})`;
    return `${inner}, ${mid}, ${outer}`;
  };

  const titleShadow = buildNeonTextShadow(primaryRgb, glowScale);
  const artistShadow = buildNeonTextShadow(secondaryRgb, glowScale * 0.7);
  const accentShadow = buildNeonTextShadow(accentRgb, glowScale * 0.55);

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

  const frameStyle: React.CSSProperties = useMemo(() => {
    const rgb = hexToRgbTriplet(primaryNeon, '255, 0, 255');
    return {
      flex: 1,
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      position: 'relative',
      padding: '18px 20px',
      borderRadius: 2,
      backgroundColor: hexToRgba(bgColor, common.backgroundOpacity),
      // Thin 1px border using primaryNeon at low opacity. Top/bottom gradient
      // lines come from the NeonEdges helper below.
      border: `1px solid rgba(${rgb}, ${0.35 * common.borderOpacity})`,
      boxShadow: `inset 0 0 ${30 * glowScale}px rgba(${rgb}, ${0.08 * glowScale})`,
      overflow: 'hidden',
      backdropFilter: buildBlurFilter(common.blurIntensity),
      WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
    };
  }, [bgColor, glowScale, primaryNeon, common.backgroundOpacity, common.borderOpacity, common.blurIntensity]);

  // === Idle state ===
  if (!displayTrack) {
    return (
      <div style={containerStyle}>
        <div style={frameStyle}>
          {options.showScanlines && <ScanlineOverlay />}
          <NeonEdges primaryRgb={primaryRgb} secondaryRgb={secondaryRgb} glowScale={glowScale} />

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 10,
            }}
          >
            <StatusDot color={secondaryNeon} reducedMotion={reducedMotion} />
            <span
              style={{
                fontFamily: accentFont,
                fontSize: common.scale(12),
                letterSpacing: 3,
                textTransform: 'uppercase',
                color: secondaryNeon,
                textShadow: artistShadow,
              }}
            >
              NOW PLAYING
            </span>
          </div>
          <div
            style={{
              minHeight: 72,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 12,
              fontFamily: headingFont,
              fontSize: common.scale(18),
              fontWeight: 700,
              letterSpacing: 2,
              color: primaryNeon,
              textShadow: titleShadow,
              textTransform: 'uppercase',
            }}
          >
            AWAITING SIGNAL...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={frameStyle}>
        {options.showScanlines && <ScanlineOverlay />}
        <NeonEdges primaryRgb={primaryRgb} secondaryRgb={secondaryRgb} glowScale={glowScale} />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 12,
          }}
        >
          <StatusDot color={primaryNeon} reducedMotion={reducedMotion} />
          <span
            style={{
              fontFamily: accentFont,
              fontSize: common.scale(10),
              letterSpacing: 3,
              textTransform: 'uppercase',
              color: secondaryNeon,
              textShadow: artistShadow,
            }}
          >
            NOW PLAYING
          </span>
          {displayTrack.isDonation && (
            <span
              style={{
                marginLeft: 'auto',
                fontFamily: accentFont,
                fontSize: common.scale(11),
                letterSpacing: 2,
                padding: '3px 8px',
                border: `1px solid rgba(${primaryRgb}, 0.8)`,
                color: primaryNeon,
                textShadow: titleShadow,
                textTransform: 'uppercase',
              }}
            >
              DONATION
            </span>
          )}
          {displayTrack.isHomework && (
            <span
              style={{
                marginLeft: displayTrack.isDonation ? 6 : 'auto',
                fontFamily: accentFont,
                fontSize: common.scale(11),
                letterSpacing: 2,
                padding: '3px 8px',
                border: `1px solid rgba(${secondaryRgb}, 0.8)`,
                color: secondaryNeon,
                textShadow: artistShadow,
                textTransform: 'uppercase',
              }}
            >
              HW
            </span>
          )}

          {displayTrack.isRandom && (
            <span
              style={{
                marginLeft: displayTrack.isDonation ? 6 : 'auto',
                fontFamily: accentFont,
                fontSize: common.scale(11),
                letterSpacing: 2,
                padding: '3px 8px',
                border: `1px solid rgba(${secondaryRgb}, 0.8)`,
                color: secondaryNeon,
                textShadow: artistShadow,
                textTransform: 'uppercase',
              }}
            >
              RND
            </span>
          )}
        </div>

        <div
          className={transitionClassName}
          style={{
            display: 'flex',
            gap: 16,
            alignItems: 'center',
          }}
        >
          {/* Album art with neon border */}
          <div
            style={{
              flexShrink: 0,
              width: 82,
              height: 82,
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              border: `1px solid rgba(${primaryRgb}, 0.7)`,
              boxShadow: `0 0 ${14 * glowScale}px rgba(${primaryRgb}, ${0.55 * glowScale}), inset 0 0 ${12 * glowScale}px rgba(${secondaryRgb}, ${0.25 * glowScale})`,
              overflow: 'hidden',
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
                  filter: 'saturate(1.2) contrast(1.08)',
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
                  color: primaryNeon,
                  fontFamily: headingFont,
                  fontSize: common.scale(30),
                  textShadow: titleShadow,
                }}
              >
                {'\u266B'}
              </div>
            )}
          </div>

          {/* Title + artist + progress */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3
              style={{
                fontFamily: headingFont,
                fontWeight: 700,
                fontSize: common.scale(26),
                lineHeight: 1.25,
                margin: 0,
                color: primaryNeon,
                textShadow: titleShadow,
                textTransform: 'uppercase',
                letterSpacing: 1,
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
                fontWeight: 400,
                fontSize: common.scale(19),
                margin: '4px 0 0 0',
                color: secondaryNeon,
                textShadow: artistShadow,
                letterSpacing: 0.5,
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
                    height: 3,
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
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
                      background: `linear-gradient(90deg, ${primaryNeon}, ${accentNeon}, ${secondaryNeon})`,
                      boxShadow: `0 0 ${10 * glowScale}px rgba(${primaryRgb}, ${0.75 * glowScale}), 0 0 ${18 * glowScale}px rgba(${secondaryRgb}, ${0.4 * glowScale})`,
                      transition: reducedMotion ? 'none' : 'width 1s linear',
                    }}
                  />
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginTop: 4,
                    fontFamily: accentFont,
                    fontSize: common.scale(11),
                    letterSpacing: 1,
                    color: accentNeon,
                    textShadow: accentShadow,
                    opacity: 0.85,
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

/**
 * Thin scanline overlay using a repeating-linear-gradient. This is the
 * CRT monitor vibe — faint alternating dark lines across the card.
 */
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

/**
 * Top and bottom gradient neon rail lines across the card interior. Sells
 * the signage feel without relying on ::before / ::after pseudo elements
 * on an inline-styled div.
 */
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

/**
 * Glowing dot with optional pulse. Used as a signal / status indicator.
 * Uses the status-pulse keyframe defined in animations.css.
 */
function StatusDot({ color, reducedMotion }: { color: string; reducedMotion: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor: color,
        boxShadow: `0 0 6px ${color}, 0 0 12px ${color}`,
        animation: reducedMotion ? undefined : 'neon-cyberpunk-status-pulse 1.4s ease-in-out infinite',
      }}
    />
  );
}
NowPlaying.displayName = 'NowPlaying';
export default memo(NowPlaying);
