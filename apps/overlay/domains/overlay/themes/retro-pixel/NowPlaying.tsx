'use client';

import { useEffect, useMemo, useState, memo} from 'react';
import type { ThemeWidgetProps } from '../types';
import { buildFontFamilyValue, useCommonOptions, useTrackTransition } from '../shared';
import { hexToRgba, withOpacity, buildBlurFilter } from '../shared/apply-transparency';
import { defaultOptions, type RetroPixelOptions } from './config';
import type { SongRequest } from '../../types/overlay';
import { shouldShowPlaybackProgress } from '../../components/now-playing/types';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): RetroPixelOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<RetroPixelOptions>),
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
  if (Number.isNaN(intensity)) return 60;
  return Math.max(0, Math.min(100, intensity));
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
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.heading ?? ['monospace']),
    [common.fontFamily, fonts.roles.heading],
  );
  const bodyFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['monospace']),
    [common.fontFamily, fonts.roles.body],
  );

  const currentTrack = buildDisplayTrack(data?.nowPlaying ?? null);

  const { displayTrack, className: transitionClassName } = useTrackTransition({
    currentTrack,
    trackKey: currentTrack?.id ?? null,
    animation: animations['track.change'],
    reducedMotion,
    themeId: 'retro-pixel',
    isSameTrack: (a, b) => a?.id === b?.id,
  });

  // Blinking cursor for the idle state. Skipped entirely under reduced motion.
  const [cursorVisible, setCursorVisible] = useState(true);
  useEffect(() => {
    if (reducedMotion) {
      return;
    }
    const id = window.setInterval(() => setCursorVisible((v) => !v), 500);
    return () => window.clearInterval(id);
  }, [reducedMotion]);

  const showProgress = shouldShowPlaybackProgress(
    playbackProgress ?? { currentTime: 0, duration: 0, state: 'unstarted', percentage: 0 },
  );
  const progressFraction = showProgress && playbackProgress
    ? Math.min(1, Math.max(0, playbackProgress.percentage / 100))
    : 0;

  const glow = clampGlow(options.glowIntensity);
  const glowAlpha = 0.35 + (glow / 100) * 0.55; // 0.35 → 0.9
  const glowBlur = 6 + (glow / 100) * 18; // 6 → 24
  const borderColor = options.primaryColor;
  const accentColor = common.accentColor ?? options.accentColor;
  const bodyTextColor = common.textColor ?? accentColor;
  const bgColor = options.backgroundColor;
  const pixelScale = Math.max(1, Math.min(4, options.pixelScale ?? 2));
  const borderWidth = pixelScale * 2; // 2 → 8 px

  const titleShadow = `0 0 ${glowBlur * 0.6}px rgba(255, 110, 199, ${glowAlpha}), 0 0 ${glowBlur}px rgba(255, 110, 199, ${glowAlpha * 0.6}), 2px 2px 0 rgba(0, 0, 0, 0.85)`;
  const accentShadow = `0 0 ${glowBlur * 0.5}px rgba(0, 255, 247, ${glowAlpha * 0.8}), 1px 1px 0 rgba(0, 0, 0, 0.85)`;

  // Build a 20-cell pixel chunk progress bar
  const totalCells = 20;
  const filledCells = Math.round(progressFraction * totalCells);

  const containerStyle: React.CSSProperties = useMemo(() => ({
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: bodyFont,
    fontWeight: common.fontWeight,
    color: bodyTextColor,
    background: 'transparent',
  }), [bodyTextColor, bodyFont, common.textSizeMultiplier, common.fontWeight]);

  const frameStyle: React.CSSProperties = useMemo(() => ({
    flex: 1,
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    backgroundColor: hexToRgba(bgColor, common.backgroundOpacity),
    border: `${borderWidth}px solid ${withOpacity(borderColor, common.borderOpacity)}`,
    borderRadius: 0,
    padding: pixelScale * 8,
    position: 'relative',
    boxShadow: `0 0 0 ${pixelScale}px rgba(0, 0, 0, 0.85), 0 0 ${glowBlur * 2}px rgba(0, 255, 247, ${glowAlpha * 0.4}) inset`,
    overflow: 'hidden',
    imageRendering: 'pixelated',
    backdropFilter: buildBlurFilter(common.blurIntensity),
    WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
  }), [bgColor, borderColor, borderWidth, glowAlpha, glowBlur, pixelScale, common.backgroundOpacity, common.borderOpacity, common.blurIntensity]);

  const headerStyle: React.CSSProperties = useMemo(() => ({
    fontFamily: headingFont,
    color: borderColor,
    fontSize: common.scale(18),
    letterSpacing: 2,
    marginBottom: pixelScale * 6,
    textShadow: `0 0 ${glowBlur * 0.6}px rgba(255, 110, 199, ${glowAlpha}), 0 0 ${glowBlur}px rgba(255, 110, 199, ${glowAlpha * 0.6}), 2px 2px 0 rgba(0, 0, 0, 0.85)`,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    textTransform: 'uppercase',
  }), [borderColor, glowAlpha, glowBlur, headingFont, pixelScale, common.textSizeMultiplier]);

  const titleStyle: React.CSSProperties = useMemo(() => ({
    fontFamily: headingFont,
    color: borderColor,
    fontSize: common.scale(34),
    lineHeight: 1.4,
    textShadow: `0 0 ${glowBlur * 0.6}px rgba(255, 110, 199, ${glowAlpha}), 0 0 ${glowBlur}px rgba(255, 110, 199, ${glowAlpha * 0.6}), 2px 2px 0 rgba(0, 0, 0, 0.85)`,
    margin: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textTransform: 'uppercase',
    letterSpacing: 1,
  }), [borderColor, glowAlpha, glowBlur, headingFont, common.textSizeMultiplier]);

  const artistStyle: React.CSSProperties = useMemo(() => ({
    fontFamily: bodyFont,
    color: accentColor,
    fontSize: common.scale(24),
    marginTop: pixelScale * 4,
    textShadow: `0 0 ${glowBlur * 0.5}px rgba(0, 255, 247, ${glowAlpha * 0.8}), 1px 1px 0 rgba(0, 0, 0, 0.85)`,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textTransform: 'uppercase',
    letterSpacing: 1,
  }), [accentColor, bodyFont, glowAlpha, glowBlur, pixelScale, common.textSizeMultiplier]);

  // === Idle / no song state ===
  if (!displayTrack) {
    return (
      <div style={containerStyle}>
        <div style={frameStyle}>
          {options.showScanlines && <ScanlinesOverlay />}
          <CrtCorners color={borderColor} pixelScale={pixelScale} />
          <div style={headerStyle}>
            <span aria-hidden="true">{'\u25C6'}</span>
            <span>NOW PLAYING</span>
          </div>
          <div
            style={{
              minHeight: 96,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: pixelScale * 8,
              border: `${pixelScale}px dashed ${accentColor}`,
              fontFamily: headingFont,
              fontSize: common.scale(12),
              color: accentColor,
              textShadow: accentShadow,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
            }}
          >
            <span>INSERT COIN</span>
            <span
              aria-hidden="true"
              style={{
                marginLeft: 8,
                opacity: cursorVisible ? 1 : 0,
              }}
            >
              {'\u2588'}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={frameStyle}>
        {options.showScanlines && <ScanlinesOverlay />}
        <CrtCorners color={borderColor} pixelScale={pixelScale} />

        <div style={headerStyle}>
          <span aria-hidden="true">{'\u25C6'}</span>
          <span>NOW PLAYING</span>
          {displayTrack.isDonation && (
            <span
              style={{
                marginLeft: 'auto',
                fontSize: common.scale(11),
                padding: '2px 6px',
                backgroundColor: borderColor,
                color: bgColor,
                textShadow: 'none',
                letterSpacing: 1.5,
              }}
            >
              {'\u2605'} DONATION
            </span>
          )}
          {displayTrack.isHomework && (
            <span
              style={{
                marginLeft: displayTrack.isDonation ? 6 : 'auto',
                fontSize: common.scale(11),
                padding: '2px 6px',
                backgroundColor: accentColor,
                color: bgColor,
                textShadow: 'none',
                letterSpacing: 1.5,
              }}
            >
              HW
            </span>
          )}

          {displayTrack.isRandom && (
            <span
              style={{
                marginLeft: displayTrack.isDonation ? 6 : 'auto',
                fontSize: common.scale(11),
                padding: '2px 6px',
                backgroundColor: accentColor,
                color: bgColor,
                textShadow: 'none',
                letterSpacing: 1.5,
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
            gap: pixelScale * 8,
            alignItems: 'center',
          }}
        >
          {/* Album art with pixelated rendering */}
          <div
            style={{
              flexShrink: 0,
              width: 72,
              height: 72,
              backgroundColor: 'rgba(0, 0, 0, 0.6)',
              border: `${pixelScale}px solid ${accentColor}`,
              boxShadow: `0 0 ${glowBlur * 0.5}px rgba(0, 255, 247, ${glowAlpha * 0.7})`,
              overflow: 'hidden',
              position: 'relative',
              imageRendering: 'pixelated',
            }}
          >
            {displayTrack.albumArt ? (
              <img
                src={displayTrack.albumArt}
                alt={displayTrack.title}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  imageRendering: 'pixelated',
                  filter: `contrast(1.1) saturate(1.2)`,
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
                  color: borderColor,
                  fontFamily: headingFont,
                  fontSize: common.scale(22),
                  textShadow: titleShadow,
                }}
              >
                {'\u266B'}
              </div>
            )}
          </div>

          {/* Title + artist + progress */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={titleStyle}>{displayTrack.title}</h3>
            <p style={artistStyle}>
              {displayTrack.artist}
              {data.settings?.showRequesterName !== false && displayTrack.requesterNickname ? (
                <span style={{ opacity: 0.7 }}> · @{displayTrack.requesterNickname}</span>
              ) : null}
            </p>

            {showProgress && (
              <div
                style={{
                  marginTop: pixelScale * 6,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <div
                  style={{
                    flex: 1,
                    height: pixelScale * 4 + 4,
                    backgroundColor: 'rgba(0, 0, 0, 0.6)',
                    border: `${pixelScale}px solid ${accentColor}`,
                    display: 'flex',
                    gap: pixelScale,
                    padding: pixelScale,
                    imageRendering: 'pixelated',
                  }}
                >
                  {Array.from({ length: totalCells }).map((_, idx) => {
                    const filled = idx < filledCells;
                    return (
                      <span
                        key={idx}
                        style={{
                          flex: 1,
                          backgroundColor: filled ? borderColor : 'transparent',
                          boxShadow: filled
                            ? `0 0 ${glowBlur * 0.4}px rgba(255, 110, 199, ${glowAlpha})`
                            : 'none',
                        }}
                      />
                    );
                  })}
                </div>
                <span
                  style={{
                    fontFamily: headingFont,
                    fontSize: common.scale(11),
                    color: accentColor,
                    textShadow: accentShadow,
                    letterSpacing: 0.5,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {Math.round(progressFraction * 100)}%
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Decorative CRT scanline overlay. Cheap repeating-linear-gradient.
 */
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

/**
 * Tiny pixel-art corner brackets to sell the 8-bit frame look.
 */
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
NowPlaying.displayName = 'NowPlaying';
export default memo(NowPlaying);
