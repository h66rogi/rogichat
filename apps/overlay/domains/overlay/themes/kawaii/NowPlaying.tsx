'use client';

import { useMemo, memo} from 'react';
import type { ThemeWidgetProps } from '../types';
import { buildFontFamilyValue, useCommonOptions, useTrackTransition } from '../shared';
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

function clampRadius(value: number): number {
  if (Number.isNaN(value)) return 20;
  return Math.max(8, Math.min(32, value));
}

/**
 * Return a decoration glyph per row/variant.
 * The kawaii theme uses three variants: stars, hearts, sparkles.
 */
function decorationGlyph(style: KawaiiOptions['decorationStyle']): string {
  switch (style) {
    case 'hearts':
      return '\u2665'; // ♥
    case 'sparkles':
      return '\u2728'; // ✨
    case 'stars':
    default:
      return '\u2605'; // ★
  }
}

function floatingGlyph(style: KawaiiOptions['decorationStyle']): string {
  switch (style) {
    case 'hearts':
      return '\u2665'; // ♥
    case 'sparkles':
      return '\u266A'; // ♪
    case 'stars':
    default:
      return '\u266B'; // ♫
  }
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
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.heading ?? ['Fredoka', 'sans-serif']),
    [common.fontFamily, fonts.roles.heading],
  );
  const bodyFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['Comfortaa', 'sans-serif']),
    [common.fontFamily, fonts.roles.body],
  );

  const currentTrack = buildDisplayTrack(data?.nowPlaying ?? null);

  const { displayTrack, className: transitionClassName } = useTrackTransition({
    currentTrack,
    trackKey: currentTrack?.id ?? null,
    animation: animations['track.change'],
    reducedMotion,
    themeId: 'kawaii',
    isSameTrack: (a, b) => a?.id === b?.id,
  });

  const mainColor = options.mainColor || '#ffb6d9';
  const accentColor = common.accentColor ?? options.accentColor ?? '#b088f9';
  const bgColor = options.backgroundColor || '#fff5fa';
  const textColor = common.textColor ?? options.textColor ?? '#d63384';
  const borderRadius = clampRadius(options.borderRadius);
  const deco = decorationGlyph(options.decorationStyle);
  const floating = floatingGlyph(options.decorationStyle);

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
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    padding: 12,
    borderRadius,
    backgroundColor: hexToRgba(bgColor, common.backgroundOpacity),
    border: `3px solid ${withOpacity(mainColor, common.borderOpacity)}`,
    overflow: 'hidden',
    backdropFilter: buildBlurFilter(common.blurIntensity),
    WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
  }), [bgColor, borderRadius, mainColor, common.backgroundOpacity, common.borderOpacity, common.blurIntensity]);

  const floatingDecorationStyle: React.CSSProperties = useMemo(() => ({
    position: 'absolute',
    top: 10,
    right: 14,
    fontSize: common.scale(22),
    color: accentColor,
    pointerEvents: 'none',
    animation: reducedMotion ? undefined : 'kawaii-float 3s ease-in-out infinite',
  }), [accentColor, reducedMotion, common.textSizeMultiplier]);

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

  // === Idle / no song state ===
  if (!displayTrack) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div aria-hidden="true" style={floatingDecorationStyle}>
            {floating}
          </div>
          <div
            style={{
              minHeight: 88,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div
              style={{
                fontFamily: headingFont,
                fontSize: common.scale(18),
                fontWeight: 700,
                color: textColor,
                letterSpacing: 0.3,
              }}
            >
              Waiting for a song {'\u266A'}
            </div>
            <div
              style={{
                fontFamily: bodyFont,
                fontSize: common.scale(13),
                color: accentColor,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span aria-hidden="true">{'\u2665'}</span>
              <span>Say hi in chat and request a track</span>
              <span aria-hidden="true">{'\u2665'}</span>
            </div>
          </div>
          <div aria-hidden="true" style={underlineStyle} />
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div className={transitionClassName} style={cardStyle}>
        <div aria-hidden="true" style={floatingDecorationStyle}>
          {floating}
        </div>

        <div
          style={{
            display: 'flex',
            gap: 14,
            alignItems: 'center',
          }}
        >
          {/* Album art — small rounded */}
          <div
            style={{
              flexShrink: 0,
              width: 80,
              height: 80,
              borderRadius: Math.max(6, borderRadius / 1.4),
              overflow: 'hidden',
              backgroundColor: `${mainColor}22`,
              border: `2px solid ${mainColor}`,
              boxShadow: `0 4px 12px rgba(176, 136, 249, 0.22)`,
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
                  opacity: 0.7,
                  fontFamily: headingFont,
                  fontSize: common.scale(28),
                }}
              >
                {'\u266B'}
              </div>
            )}
          </div>

          {/* Title + artist + decorations */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 2,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  fontSize: common.scale(14),
                  color: accentColor,
                }}
              >
                {deco}
              </span>
              <span
                style={{
                  fontFamily: bodyFont,
                  fontSize: common.scale(14),
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                  color: accentColor,
                  opacity: 0.85,
                }}
              >
                Now Playing
              </span>
              {displayTrack.isDonation && (
                <span
                  style={{
                    fontFamily: bodyFont,
                    fontSize: common.scale(11),
                    letterSpacing: 0.5,
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: `linear-gradient(90deg, ${mainColor}, ${accentColor})`,
                    color: '#ffffff',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                  }}
                >
                  {'\u2605'} Donation
                </span>
              )}
              {displayTrack.isHomework && (
                <span
                  style={{
                    fontFamily: bodyFont,
                    fontSize: common.scale(11),
                    letterSpacing: 0.5,
                    padding: '2px 8px',
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

              {displayTrack.isRandom && (
                <span
                  style={{
                    fontFamily: bodyFont,
                    fontSize: common.scale(11),
                    letterSpacing: 0.5,
                    padding: '2px 8px',
                    borderRadius: 999,
                    backgroundColor: `${accentColor}33`,
                    color: accentColor,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    border: `1px solid ${accentColor}66`,
                  }}
                >
                  RND
                </span>
              )}
            </div>
            <h3
              style={{
                fontFamily: headingFont,
                fontSize: common.scale(29),
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
                fontSize: common.scale(21),
                fontWeight: 400,
                margin: '4px 0 0 0',
                color: accentColor,
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

            {/* Decoration row — stars/hearts/sparkles */}
            <div
              aria-hidden="true"
              style={{
                marginTop: 4,
                display: 'flex',
                gap: 6,
                fontSize: common.scale(11),
                color: mainColor,
              }}
            >
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  style={{
                    opacity: 0.85,
                    color: i % 2 === 0 ? mainColor : accentColor,
                    animation: reducedMotion
                      ? undefined
                      : `kawaii-sparkle-twinkle 1.6s ease-in-out ${i * 0.2}s infinite`,
                  }}
                >
                  {deco}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Gradient underline */}
        <div aria-hidden="true" style={underlineStyle} />
      </div>
    </div>
  );
}
NowPlaying.displayName = 'NowPlaying';
export default memo(NowPlaying);
