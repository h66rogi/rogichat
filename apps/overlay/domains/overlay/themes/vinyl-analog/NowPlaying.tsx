'use client';

import { useMemo, memo} from 'react';
import type { ThemeWidgetProps } from '../types';
import { buildFontFamilyValue, useCommonOptions, useTrackTransition } from '../shared';
import { hexToRgba, withOpacity, buildBlurFilter } from '../shared/apply-transparency';
import { defaultOptions, type VinylAnalogOptions } from './config';
import type { SongRequest } from '../../types/overlay';
import { shouldShowPlaybackProgress, formatTime } from '../../components/now-playing/types';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): VinylAnalogOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<VinylAnalogOptions>),
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
    title: now.song?.title || now.rawTitle || 'Untitled',
    artist: now.song?.artist?.name || now.rawArtist || 'Unknown Artist',
    albumArt: now.song?.albumArt,
    isDonation: (now.donationAmount ?? 0) > 0,
    isHomework: !!now.isHomework,

    isRandom: !!now.isRandom,
    requesterNickname: now.requesterNickname || undefined,
  };
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (Number.isNaN(value)) return fallback;
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
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.heading ?? ['Playfair Display', 'serif']),
    [common.fontFamily, fonts.roles.heading],
  );
  const bodyFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['Lora', 'serif']),
    [common.fontFamily, fonts.roles.body],
  );
  const accentFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.accent ?? ['Lora', 'serif']),
    [common.fontFamily, fonts.roles.accent],
  );

  const currentTrack = buildDisplayTrack(data?.nowPlaying ?? null);

  const { displayTrack, className: transitionClassName } = useTrackTransition({
    currentTrack,
    trackKey: currentTrack?.id ?? null,
    animation: animations['track.change'],
    reducedMotion,
    themeId: 'vinyl-analog',
    isSameTrack: (a, b) => a?.id === b?.id,
  });

  const showProgress = shouldShowPlaybackProgress(
    playbackProgress ?? { currentTime: 0, duration: 0, state: 'unstarted', percentage: 0 },
  );

  const discColor = options.discColor || defaultOptions.discColor;
  const labelColor = options.labelColor || defaultOptions.labelColor;
  const accentColor = common.accentColor ?? options.accentColor ?? defaultOptions.accentColor;
  const bgColor = options.backgroundColor || defaultOptions.backgroundColor;
  const textColor = common.textColor ?? options.textColor ?? defaultOptions.textColor;
  const spinSpeed = clampNumber(options.spinSpeed, 1, 10, defaultOptions.spinSpeed);
  const showSpin = !!options.showSpinAnimation;

  const containerStyle: React.CSSProperties = useMemo(() => ({
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: bodyFont,
    fontWeight: common.fontWeight,
    color: textColor,
    background: 'transparent',
    boxSizing: 'border-box',
  }), [bodyFont, common.textSizeMultiplier, common.fontWeight, textColor]);

  // Frame: warm wood tone with subtle vintage texture via layered gradients.
  const frameStyle: React.CSSProperties = useMemo(() => ({
    flex: 1,
    width: '100%',
    backgroundColor: hexToRgba(bgColor, common.backgroundOpacity),
    backgroundImage: [
      // Subtle radial vignette
      `radial-gradient(ellipse at 30% 20%, rgba(255, 220, 180, 0.08), transparent 55%)`,
      // Horizontal wood grain feel
      `repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.05) 0px, rgba(0, 0, 0, 0.05) 1px, transparent 1px, transparent 5px)`,
      // Warm glow behind the disc area
      `radial-gradient(circle at 22% 50%, rgba(212, 165, 116, 0.1), transparent 45%)`,
    ].join(', '),
    border: `1px solid ${withOpacity(accentColor, common.borderOpacity * 0.25)}`,
    borderRadius: 12,
    padding: '22px 26px',
    position: 'relative',
    boxShadow: [
      'inset 0 1px 0 rgba(255, 230, 190, 0.08)',
      'inset 0 0 40px rgba(0, 0, 0, 0.45)',
    ].join(', '),
    display: 'flex',
    alignItems: 'center',
    gap: 22,
    overflow: 'hidden',
    boxSizing: 'border-box',
    backdropFilter: buildBlurFilter(common.blurIntensity),
    WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
  }), [accentColor, bgColor, common.backgroundOpacity, common.borderOpacity, common.blurIntensity]);

  // The LP disc: 100x100 with conic-gradient grooves, an inner label, and center hole.
  const discSize = 100;
  const labelSize = Math.round(discSize * 0.5); // 50
  const holeSize = Math.round(discSize * 0.06); // tiny center hole

  // Shade the label a touch darker than the picked labelColor so the rim
  // reads as a proper sticker pressed onto the vinyl.
  const discShellStyle: React.CSSProperties = useMemo(() => ({
    position: 'relative',
    width: discSize,
    height: discSize,
    flexShrink: 0,
    borderRadius: '50%',
    // Conic-gradient grooves — concentric tone variation so the LP reads as
    // spinning when the outer shell rotates.
    backgroundImage: [
      // Subtle sheen hotspot
      `radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.08), transparent 55%)`,
      // The actual grooves — conic-gradient around the center
      `conic-gradient(from 0deg, ${discColor} 0deg, #2a2a2a 30deg, ${discColor} 60deg, #2a2a2a 90deg, ${discColor} 120deg, #2a2a2a 150deg, ${discColor} 180deg, #2a2a2a 210deg, ${discColor} 240deg, #2a2a2a 270deg, ${discColor} 300deg, #2a2a2a 330deg, ${discColor} 360deg)`,
    ].join(', '),
    backgroundColor: discColor,
    boxShadow: [
      'inset 0 0 0 1px rgba(255, 255, 255, 0.08)',
      'inset 0 0 14px rgba(0, 0, 0, 0.6)',
      `0 0 0 1px ${discColor}`,
      '0 6px 16px rgba(0, 0, 0, 0.55)',
    ].join(', '),
    animation:
      showSpin && !reducedMotion
        ? `vinyl-analog-spin ${spinSpeed}s linear infinite`
        : undefined,
  }), [discColor, discSize, reducedMotion, showSpin, spinSpeed]);

  const discLabelStyle: React.CSSProperties = useMemo(() => ({
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: labelSize,
    height: labelSize,
    marginTop: -labelSize / 2,
    marginLeft: -labelSize / 2,
    borderRadius: '50%',
    backgroundImage: `radial-gradient(circle at 40% 35%, ${labelColor}, ${labelColor}cc 55%, ${labelColor}88 100%)`,
    backgroundColor: labelColor,
    boxShadow: [
      'inset 0 0 0 1px rgba(0, 0, 0, 0.35)',
      'inset 0 0 8px rgba(0, 0, 0, 0.35)',
    ].join(', '),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: accentFont,
    fontSize: common.scale(8),
    fontStyle: 'italic',
    letterSpacing: 1,
    color: '#f5e6c8',
    textShadow: '0 1px 0 rgba(0, 0, 0, 0.5)',
  }), [accentFont, labelColor, labelSize, common.textSizeMultiplier]);

  const discHoleStyle: React.CSSProperties = useMemo(() => ({
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: holeSize,
    height: holeSize,
    marginTop: -holeSize / 2,
    marginLeft: -holeSize / 2,
    borderRadius: '50%',
    backgroundColor: '#0a0605',
    boxShadow: 'inset 0 1px 2px rgba(0, 0, 0, 0.95), 0 0 0 1px rgba(0, 0, 0, 0.8)',
  }), [holeSize]);

  const textColumnStyle: React.CSSProperties = useMemo(() => ({
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  }), []);

  const eyebrowStyle: React.CSSProperties = useMemo(() => ({
    fontFamily: accentFont,
    fontSize: common.scale(12),
    fontStyle: 'italic',
    letterSpacing: 3,
    textTransform: 'uppercase',
    color: accentColor,
    opacity: 0.85,
    marginBottom: 2,
  }), [accentColor, accentFont, common.textSizeMultiplier]);

  const titleStyle: React.CSSProperties = useMemo(() => ({
    fontFamily: headingFont,
    fontSize: common.scale(26),
    fontWeight: 700,
    lineHeight: 1.2,
    color: textColor,
    margin: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }), [headingFont, textColor, common.textSizeMultiplier]);

  const artistStyle: React.CSSProperties = useMemo(() => ({
    fontFamily: bodyFont,
    fontSize: common.scale(19),
    fontWeight: 400,
    color: accentColor,
    margin: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    opacity: 0.95,
  }), [accentColor, bodyFont, common.textSizeMultiplier]);

  const metaStyle: React.CSSProperties = useMemo(() => ({
    fontFamily: bodyFont,
    fontSize: common.scale(13),
    fontStyle: 'italic',
    color: textColor,
    opacity: 0.5,
    marginTop: 2,
  }), [bodyFont, textColor, common.textSizeMultiplier]);

  const timeStyle: React.CSSProperties = useMemo(() => ({
    fontFamily: accentFont,
    fontSize: common.scale(13),
    fontStyle: 'italic',
    color: textColor,
    opacity: 0.6,
    marginTop: 6,
    letterSpacing: 0.5,
  }), [accentFont, textColor, common.textSizeMultiplier]);

  const discMarkup = (
    <div aria-hidden="true" style={discShellStyle}>
      <div style={discLabelStyle}>
        <span>LP</span>
      </div>
      <div style={discHoleStyle} />
    </div>
  );

  // === Idle / no song state ===
  if (!displayTrack) {
    return (
      <div style={containerStyle}>
        <div style={frameStyle}>
          {discMarkup}
          <div style={textColumnStyle}>
            <div style={eyebrowStyle}>{'\u266B'} NOW PLAYING</div>
            <h3 style={titleStyle}>Silence</h3>
            <p style={artistStyle}>No record on the turntable</p>
            <div style={metaStyle}>—</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={frameStyle}>
        {discMarkup}
        <div className={transitionClassName} style={textColumnStyle}>
          <div style={eyebrowStyle}>
            {'\u266B'} NOW PLAYING
            {displayTrack.isDonation ? ' \u00B7 DONATION' : ''}
            {displayTrack.isHomework ? ' \u00B7 HOMEWORK' : ''}
          </div>
          <h3 style={titleStyle}>{displayTrack.title}</h3>
          <p style={artistStyle}>
            {displayTrack.artist}
            {data.settings?.showRequesterName !== false && displayTrack.requesterNickname ? (
              <span style={{ opacity: 0.7 }}> · @{displayTrack.requesterNickname}</span>
            ) : null}
          </p>
          {showProgress && playbackProgress && (
            <div style={metaStyle}>
              {formatTime(playbackProgress.currentTime)} / {formatTime(playbackProgress.duration)} &middot; Side A
            </div>
          )}
          <div style={timeStyle}>1976 &middot; Asylum Records</div>
        </div>
      </div>
    </div>
  );
}
NowPlaying.displayName = 'NowPlaying';
export default memo(NowPlaying);
