'use client';

import { useMemo, memo} from 'react';
import type { ThemeWidgetProps } from '../types';
import { buildFontFamilyValue, useCommonOptions, useTrackTransition } from '../shared';
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

function clampTilt(value: number): number {
  if (Number.isNaN(value)) return 2;
  return Math.max(0, Math.min(5, value));
}

function clampRoughness(value: number): number {
  if (Number.isNaN(value)) return 2;
  return Math.max(1, Math.min(4, value));
}

/**
 * Pseudo-random tilt within `[-tiltMax, tiltMax]` derived from a stable id.
 * The returned angle is biased into the "natural notebook" range of about
 * -1deg to +2deg by default so the card never looks comically off-axis.
 */
function pickTilt(seed: string | number, tiltMax: number): number {
  const text = String(seed);
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  // Map hash → [0, 1)
  const norm = ((hash >>> 0) % 1000) / 1000;
  // Map [0,1) → [-tiltMax, tiltMax]
  const range = tiltMax * 2;
  return parseFloat((norm * range - tiltMax).toFixed(2));
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
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.heading ?? ['Caveat', 'cursive']),
    [common.fontFamily, fonts.roles.heading],
  );
  const bodyFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['Patrick Hand', 'sans-serif']),
    [common.fontFamily, fonts.roles.body],
  );

  const currentTrack = buildDisplayTrack(data?.nowPlaying ?? null);

  const { displayTrack, className: transitionClassName } = useTrackTransition({
    currentTrack,
    trackKey: currentTrack?.id ?? null,
    animation: animations['track.change'],
    reducedMotion,
    themeId: 'hand-drawn',
    isSameTrack: (a, b) => a?.id === b?.id,
  });

  const paperColor = options.paperColor || '#faf5eb';
  const inkColor = common.textColor ?? options.inkColor ?? '#2c2c2c';
  const accentColor = common.accentColor ?? options.accentColor ?? '#ff6b6b';
  const highlightColor = options.highlightColor || '#ffeb3b';
  const tiltMax = clampTilt(options.tiltMax);
  const roughness = clampRoughness(options.borderRoughness);
  const showTape = options.showTape !== false;

  // Tilt the card by a stable amount based on the track id (-1deg → +2deg by default).
  const tiltDeg = useMemo(() => {
    if (!displayTrack) return parseFloat((tiltMax * 0.5).toFixed(2));
    return pickTilt(displayTrack.id, tiltMax);
  }, [displayTrack, tiltMax]);

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
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    padding: '28px 24px 22px 24px',
    backgroundColor: hexToRgba(paperColor, common.backgroundOpacity),
    // Subtle "lined paper" pattern (very subtle horizontal rule lines).
    backgroundImage: `repeating-linear-gradient(
      to bottom,
      transparent 0px,
      transparent 26px,
      ${inkColor}14 26px,
      ${inkColor}14 27px
    )`,
    borderRadius: 6 + roughness,
    border: `${roughness}px solid ${withOpacity(inkColor, common.borderOpacity)}`,
    transform: `rotate(${tiltDeg}deg)`,
    transformOrigin: 'center center',
    overflow: 'visible',
    backdropFilter: buildBlurFilter(common.blurIntensity),
    WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
  }), [inkColor, paperColor, roughness, tiltDeg, common.backgroundOpacity, common.borderOpacity, common.blurIntensity]);

  const pinStyle: React.CSSProperties = useMemo(() => ({
    position: 'absolute',
    top: -10,
    left: 14,
    fontSize: common.scale(22),
    transform: 'rotate(-12deg)',
    pointerEvents: 'none',
    filter: `drop-shadow(0 1px 1px rgba(0,0,0,0.25))`,
  }), [common.textSizeMultiplier]);

  const tapeStyle: React.CSSProperties = useMemo(() => ({
    position: 'absolute',
    top: -12,
    right: 24,
    width: 78,
    height: 22,
    background: `linear-gradient(180deg, ${highlightColor}cc, ${highlightColor}88)`,
    border: `1px solid ${inkColor}33`,
    transform: 'rotate(-8deg)',
    boxShadow: '0 2px 4px rgba(0,0,0,0.12)',
    pointerEvents: 'none',
  }), [highlightColor, inkColor]);

  const labelStyle: React.CSSProperties = useMemo(() => ({
    fontFamily: bodyFont,
    fontSize: common.scale(14),
    fontStyle: 'italic',
    color: inkColor,
    opacity: 0.55,
    margin: '0 0 6px 0',
    letterSpacing: 0.2,
  }), [bodyFont, inkColor, common.textSizeMultiplier]);

  const titleStyle: React.CSSProperties = useMemo(() => ({
    fontFamily: headingFont,
    fontSize: common.scale(32),
    fontWeight: 700,
    color: inkColor,
    lineHeight: 1.15,
    margin: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }), [headingFont, inkColor, common.textSizeMultiplier]);

  const artistStyle: React.CSSProperties = useMemo(() => ({
    fontFamily: headingFont,
    fontSize: common.scale(19),
    color: inkColor,
    opacity: 0.6,
    margin: '4px 0 0 0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }), [headingFont, inkColor, common.textSizeMultiplier]);

  // === Idle / no song state ===
  if (!displayTrack) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          {showTape && <div aria-hidden="true" style={tapeStyle} />}
          <div aria-hidden="true" style={pinStyle}>
            {'\u{1F4CC}'}
          </div>
          <p style={labelStyle}>{'\u270F\uFE0F'} 곧 시작...</p>
          <h3 style={{ ...titleStyle, opacity: 0.7 }}>빈 노트북 페이지</h3>
          <p style={artistStyle}>by 아무도 아직 신청하지 않았어요</p>
          <DoodleRow
            inkColor={inkColor}
            accentColor={accentColor}
            reducedMotion={reducedMotion}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div className={transitionClassName} style={cardStyle}>
        {showTape && <div aria-hidden="true" style={tapeStyle} />}
        <div aria-hidden="true" style={pinStyle}>
          {'\u{1F4CC}'}
        </div>
        <p style={labelStyle}>{'\u{1F3A7}'} 지금 듣는 중...</p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* Album art — small notebook-style sticker */}
          {displayTrack.albumArt ? (
            <div
              style={{
                flexShrink: 0,
                width: 72,
                height: 72,
                border: `${roughness}px solid ${inkColor}`,
                backgroundColor: `${paperColor}`,
                boxShadow: `0 3px 6px rgba(0,0,0,0.18)`,
                transform: 'rotate(-2deg)',
                overflow: 'hidden',
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={displayTrack.albumArt}
                alt={displayTrack.title}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  display: 'block',
                  filter: 'contrast(0.95) saturate(0.9)',
                }}
                draggable={false}
              />
            </div>
          ) : null}

          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={titleStyle}>{displayTrack.title}</h3>
            <p style={artistStyle}>
              by {displayTrack.artist}
              {data.settings?.showRequesterName !== false && displayTrack.requesterNickname ? (
                <span style={{ opacity: 0.7 }}> · @{displayTrack.requesterNickname}</span>
              ) : null}
            </p>

            {(displayTrack.isDonation || displayTrack.isHomework) && (
              <div
                style={{
                  marginTop: 8,
                  display: 'flex',
                  gap: 6,
                  flexWrap: 'wrap',
                }}
              >
                {displayTrack.isDonation && (
                  <span
                    style={{
                      fontFamily: headingFont,
                      fontSize: common.scale(13),
                      padding: '2px 8px',
                      backgroundColor: `${highlightColor}cc`,
                      color: inkColor,
                      border: `${Math.max(1, roughness - 1)}px solid ${inkColor}`,
                      transform: 'rotate(-1.5deg)',
                      letterSpacing: 0.2,
                    }}
                  >
                    {'\u2605'} 후원곡
                  </span>
                )}
                {displayTrack.isHomework && (
                  <span
                    style={{
                      fontFamily: headingFont,
                      fontSize: common.scale(13),
                      padding: '2px 8px',
                      backgroundColor: 'transparent',
                      color: accentColor,
                      border: `${Math.max(1, roughness - 1)}px dashed ${accentColor}`,
                      transform: 'rotate(1.2deg)',
                      letterSpacing: 0.2,
                    }}
                  >
                    숙제
                  </span>
                )}

                {displayTrack.isRandom && (
                  <span
                    style={{
                      fontFamily: headingFont,
                      fontSize: common.scale(13),
                      padding: '2px 8px',
                      backgroundColor: 'transparent',
                      color: accentColor,
                      border: `${Math.max(1, roughness - 1)}px dashed ${accentColor}`,
                      transform: 'rotate(1.2deg)',
                      letterSpacing: 0.2,
                    }}
                  >
                    랜덤
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <DoodleRow
          inkColor={inkColor}
          accentColor={accentColor}
          reducedMotion={reducedMotion}
        />
      </div>
    </div>
  );
}

/**
 * Tiny row of music doodles at very low opacity so the card feels like
 * a margin-doodled notebook page without distracting from the title.
 */
function DoodleRow({
  inkColor,
  accentColor,
  reducedMotion,
}: {
  inkColor: string;
  accentColor: string;
  reducedMotion: boolean;
}) {
  const glyphs = ['\u266A', '\u266B', '\u266C', '\u2665', '\u2606'];
  return (
    <div
      aria-hidden="true"
      style={{
        marginTop: 12,
        display: 'flex',
        gap: 10,
        fontSize: 14,
        opacity: 0.32,
        color: inkColor,
      }}
    >
      {glyphs.map((g, i) => (
        <span
          key={i}
          style={{
            color: i % 2 === 0 ? inkColor : accentColor,
            transform: `rotate(${(i - 2) * 4}deg)`,
            display: 'inline-block',
            animation: reducedMotion
              ? undefined
              : `hand-drawn-paper-bob 3.2s ease-in-out ${i * 0.18}s infinite`,
          }}
        >
          {g}
        </span>
      ))}
    </div>
  );
}
NowPlaying.displayName = 'NowPlaying';
export default memo(NowPlaying);
