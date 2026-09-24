'use client';

import { useMemo, memo} from 'react';
import type { ThemeWidgetProps } from '../types';
import { buildFontFamilyValue, useCommonOptions, useTrackTransition } from '../shared';
import { hexToRgba, buildBlurFilter } from '../shared/apply-transparency';
import { defaultOptions, type KoreanTraditionalOptions } from './config';
import type { SongRequest } from '../../types/overlay';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): KoreanTraditionalOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<KoreanTraditionalOptions>),
  };
}

interface DisplayTrack {
  id: number | string;
  title: string;
  artist: string;
  isDonation: boolean;
  isHomework: boolean;
  isRandom: boolean;
  requesterNickname?: string;
}

function buildDisplayTrack(now: SongRequest | null | undefined): DisplayTrack | null {
  if (!now) return null;
  return {
    id: now.id,
    title: now.song?.title || now.rawTitle || '제목 미상',
    artist: now.song?.artist?.name || now.rawArtist || '미상',
    isDonation: (now.donationAmount ?? 0) > 0,
    isHomework: !!now.isHomework,

    isRandom: !!now.isRandom,
    requesterNickname: now.requesterNickname || undefined,
  };
}

/**
 * Build a hex color string with the given alpha (0-255). Accepts 6-char hex
 * like "#c0392b". Returns "#c0392bff"-style 8-char hex. Used to keep color
 * blends visually consistent against any baseColor the user picks.
 */
function withAlpha(hex: string, alpha: number): string {
  if (!hex.startsWith('#') || hex.length !== 7) return hex;
  const a = Math.max(0, Math.min(255, Math.round(alpha))).toString(16).padStart(2, '0');
  return `${hex}${a}`;
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
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.heading ?? ['Noto Serif KR', 'serif']),
    [common.fontFamily, fonts.roles.heading],
  );
  const bodyFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['Noto Serif KR', 'serif']),
    [common.fontFamily, fonts.roles.body],
  );

  const currentTrack = buildDisplayTrack(data?.nowPlaying ?? null);

  const { displayTrack, className: transitionClassName } = useTrackTransition({
    currentTrack,
    trackKey: currentTrack?.id ?? null,
    animation: animations['track.change'],
    reducedMotion,
    themeId: 'korean-traditional',
    isSameTrack: (a, b) => a?.id === b?.id,
  });

  const baseColor = options.baseColor || defaultOptions.baseColor;
  const inkColor = common.textColor ?? options.inkColor ?? defaultOptions.inkColor;
  const accentRed = common.accentColor ?? options.accentRed ?? defaultOptions.accentRed;
  const accentBrown = options.accentBrown || defaultOptions.accentBrown;
  const patternStyle = options.patternStyle || defaultOptions.patternStyle;
  const showStamp = options.showStamp ?? defaultOptions.showStamp;
  const stampText = (options.stampText ?? defaultOptions.stampText).slice(0, 4);

  const containerStyle: React.CSSProperties = useMemo(() => ({
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: bodyFont,
    fontWeight: common.fontWeight,
    color: inkColor,
    background: 'transparent',
    boxSizing: 'border-box',
  }), [bodyFont, common.textSizeMultiplier, common.fontWeight, inkColor]);

  // Subtle hanji texture: layered radial highlights + faint repeating speckle.
  // Applied to the outer container so the texture extends behind the inner border.
  const paperStyle: React.CSSProperties = useMemo(() => ({
    flex: 1,
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    backgroundColor: hexToRgba(baseColor, common.backgroundOpacity),
    backgroundImage: [
      `radial-gradient(ellipse at 20% 15%, rgba(255, 255, 255, ${0.45 * common.backgroundOpacity}), transparent 55%)`,
      `radial-gradient(ellipse at 80% 85%, ${hexToRgba(accentBrown, (22 / 255) * common.backgroundOpacity)}, transparent 60%)`,
      `repeating-radial-gradient(circle at 30% 40%, ${hexToRgba(inkColor, (8 / 255) * common.backgroundOpacity)} 0, ${hexToRgba(inkColor, (8 / 255) * common.backgroundOpacity)} 1px, transparent 1px, transparent 6px)`,
      `repeating-radial-gradient(circle at 70% 60%, ${hexToRgba(accentBrown, (10 / 255) * common.backgroundOpacity)} 0, ${hexToRgba(accentBrown, (10 / 255) * common.backgroundOpacity)} 1px, transparent 1px, transparent 9px)`,
    ].join(', '),
    padding: 26,
    position: 'relative',
    boxShadow: `inset 0 1px 0 rgba(255, 255, 255, ${0.6 * common.backgroundOpacity})`,
    borderRadius: 2,
    boxSizing: 'border-box',
    overflow: 'hidden',
    backdropFilter: buildBlurFilter(common.blurIntensity),
    WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
  }), [accentBrown, baseColor, inkColor, common.backgroundOpacity, common.blurIntensity]);

  // Inner border — 8px inset, 2px solid accentBrown with low opacity.
  const innerBorderStyle: React.CSSProperties = useMemo(() => ({
    position: 'absolute',
    top: 8,
    right: 8,
    bottom: 8,
    left: 8,
    border: `2px solid ${withAlpha(accentBrown, 90 * common.borderOpacity)}`,
    pointerEvents: 'none',
    borderRadius: 1,
  }), [accentBrown, common.borderOpacity]);

  const innerContentStyle: React.CSSProperties = useMemo(() => ({
    position: 'relative',
    padding: '20px 14px 24px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 14,
    textAlign: 'center',
  }), []);

  const eyebrowStyle: React.CSSProperties = useMemo(() => ({
    fontFamily: bodyFont,
    fontSize: common.scale(13),
    letterSpacing: 4,
    color: accentBrown,
    margin: 0,
  }), [accentBrown, bodyFont, common.textSizeMultiplier]);

  const titleStyle: React.CSSProperties = useMemo(() => ({
    fontFamily: headingFont,
    fontSize: common.scale(28),
    fontWeight: 700,
    color: inkColor,
    margin: 0,
    lineHeight: 1.3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '90%',
  }), [headingFont, inkColor, common.textSizeMultiplier]);

  const dividerStyle: React.CSSProperties = useMemo(() => ({
    width: 50,
    height: 2,
    backgroundColor: accentRed,
    margin: 0,
    border: 'none',
  }), [accentRed]);

  const artistStyle: React.CSSProperties = useMemo(() => ({
    fontFamily: bodyFont,
    fontSize: common.scale(19),
    fontWeight: 400,
    color: accentBrown,
    margin: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '90%',
  }), [accentBrown, bodyFont, common.textSizeMultiplier]);

  const tagsRow: React.CSSProperties = {
    display: 'flex',
    gap: 6,
    marginTop: 4,
    minHeight: 18,
    alignItems: 'center',
    justifyContent: 'center',
  };

  const tagBase: React.CSSProperties = {
    fontFamily: bodyFont,
    fontSize: common.scale(12),
    letterSpacing: 1.5,
    padding: '2px 8px',
    border: `1px solid ${withAlpha(accentBrown, 130)}`,
    color: accentBrown,
    borderRadius: 1,
  };

  // Optional 도장 stamp anchored to the bottom-right corner of the paper.
  const stampStyle: React.CSSProperties = useMemo(() => ({
    position: 'absolute',
    right: 24,
    bottom: 22,
    transform: 'rotate(-4deg)',
    border: `2px solid ${accentRed}`,
    color: accentRed,
    fontFamily: headingFont,
    fontStyle: 'italic',
    fontSize: common.scale(14),
    fontWeight: 700,
    letterSpacing: 2,
    padding: '4px 10px',
    opacity: 0.6,
    backgroundColor: withAlpha(accentRed, 8),
    borderRadius: 1,
    pointerEvents: 'none',
    userSelect: 'none',
  }), [accentRed, headingFont, common.textSizeMultiplier]);

  // === Idle / no song state ===
  if (!displayTrack) {
    return (
      <div style={containerStyle}>
        <div style={paperStyle}>
          <PatternDecor patternStyle={patternStyle} accentRed={accentRed} accentBrown={accentBrown} />
          <div style={innerBorderStyle} aria-hidden="true" />
          <div style={innerContentStyle}>
            <div style={eyebrowStyle}>지 금 연 주 중</div>
            <h3 style={titleStyle}>휴식 중</h3>
            <hr style={dividerStyle} aria-hidden="true" />
            <p style={artistStyle}>다음 곡을 기다리는 중</p>
            <div style={tagsRow} aria-hidden="true" />
          </div>
          {showStamp && stampText && <div style={stampStyle}>{stampText}</div>}
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={paperStyle}>
        <PatternDecor patternStyle={patternStyle} accentRed={accentRed} accentBrown={accentBrown} />
        <div style={innerBorderStyle} aria-hidden="true" />
        <div className={transitionClassName} style={innerContentStyle}>
          <div style={eyebrowStyle}>지 금 연 주 중</div>
          <h3 style={titleStyle}>{displayTrack.title}</h3>
          <hr style={dividerStyle} aria-hidden="true" />
          <p style={artistStyle}>
            {displayTrack.artist}
            {data.settings?.showRequesterName !== false && displayTrack.requesterNickname ? (
              <span style={{ opacity: 0.7 }}> · @{displayTrack.requesterNickname}</span>
            ) : null}
          </p>
          <div style={tagsRow}>
            {displayTrack.isDonation && (
              <span style={{ ...tagBase, color: accentRed, borderColor: withAlpha(accentRed, 160) }}>
                후 원
              </span>
            )}
            {displayTrack.isHomework && <span style={tagBase}>숙 제</span>}
          </div>
        </div>
        {showStamp && stampText && <div style={stampStyle}>{stampText}</div>}
      </div>
    </div>
  );
}

interface PatternDecorProps {
  patternStyle: KoreanTraditionalOptions['patternStyle'];
  accentRed: string;
  accentBrown: string;
}

/**
 * Decorative pattern element. Uses simple SVG line motifs so they scale
 * cleanly. The 'minimal' style renders nothing — the inner border alone
 * carries the visual weight in that mode.
 */
function PatternDecor({ patternStyle, accentRed, accentBrown }: PatternDecorProps) {
  if (patternStyle === 'minimal') return null;

  if (patternStyle === 'corner') {
    // Four small corner motifs — stylized 卍-like crosses in accentRed.
    const cornerSize = 18;
    const cornerStyle = (corner: 'tl' | 'tr' | 'bl' | 'br'): React.CSSProperties => ({
      position: 'absolute',
      width: cornerSize,
      height: cornerSize,
      pointerEvents: 'none',
      ...(corner === 'tl' && { top: 4, left: 4 }),
      ...(corner === 'tr' && { top: 4, right: 4 }),
      ...(corner === 'bl' && { bottom: 4, left: 4 }),
      ...(corner === 'br' && { bottom: 4, right: 4 }),
    });

    const motif = (
      <svg viewBox="0 0 18 18" width={cornerSize} height={cornerSize} aria-hidden="true">
        <path
          d="M2 2 L8 2 L8 8 L2 8 Z M10 2 L16 2 L16 8 L10 8 Z M2 10 L8 10 L8 16 L2 16 Z M10 10 L16 10 L16 16 L10 16 Z"
          fill="none"
          stroke={accentRed}
          strokeWidth={1.2}
          opacity={0.55}
        />
      </svg>
    );

    return (
      <>
        <div style={cornerStyle('tl')}>{motif}</div>
        <div style={cornerStyle('tr')}>{motif}</div>
        <div style={cornerStyle('bl')}>{motif}</div>
        <div style={cornerStyle('br')}>{motif}</div>
      </>
    );
  }

  // border pattern — repeating geometric line motif along the top and bottom.
  const stripeStyle: React.CSSProperties = {
    position: 'absolute',
    left: 14,
    right: 14,
    height: 6,
    backgroundImage: `repeating-linear-gradient(90deg, ${accentBrown}66 0, ${accentBrown}66 6px, transparent 6px, transparent 12px)`,
    pointerEvents: 'none',
    opacity: 0.55,
  };

  return (
    <>
      <div aria-hidden="true" style={{ ...stripeStyle, top: 2 }} />
      <div aria-hidden="true" style={{ ...stripeStyle, bottom: 2 }} />
    </>
  );
}
NowPlaying.displayName = 'NowPlaying';
export default memo(NowPlaying);
