'use client';

import { useMemo, memo} from 'react';
import type { ThemeWidgetProps } from '../types';
import { buildFontFamilyValue, useCommonOptions, useTrackTransition } from '../shared';
import { hexToRgba, withOpacity, buildBlurFilter } from '../shared/apply-transparency';
import { defaultOptions, type BrutalistOptions } from './config';
import type { SongRequest } from '../../types/overlay';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): BrutalistOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<BrutalistOptions>),
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
    title: now.song?.title || now.rawTitle || 'UNTITLED',
    artist: now.song?.artist?.name || now.rawArtist || 'UNKNOWN',
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
}: Props) {
  const options = useMemo(() => resolveOptions(rawOptions), [rawOptions]);
  const common = useCommonOptions(rawOptions);
  const headingFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.heading ?? ['Inter', 'sans-serif']),
    [common.fontFamily, fonts.roles.heading],
  );
  const bodyFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['Inter', 'sans-serif']),
    [common.fontFamily, fonts.roles.body],
  );

  const currentTrack = buildDisplayTrack(data?.nowPlaying ?? null);

  const { displayTrack, className: transitionClassName } = useTrackTransition({
    currentTrack,
    trackKey: currentTrack?.id ?? null,
    animation: animations['track.change'],
    reducedMotion,
    themeId: 'brutalist',
    isSameTrack: (a, b) => a?.id === b?.id,
  });

  const borderWidth = clampNumber(options.borderWidth, 2, 8, 5);
  const shadowOffset = clampNumber(options.shadowOffset, 4, 16, 10);
  const tiltAngle = clampNumber(options.tiltAngle, -5, 5, -1);
  const accentColor = common.accentColor ?? options.accentColor ?? '#ffff00';
  const dangerColor = options.dangerColor || '#ff0000';
  const bgColor = options.backgroundColor || '#f5f5dc';

  const hardShadow = `${shadowOffset}px ${shadowOffset}px 0 #000`;
  const ink = common.textColor ?? '#000000';

  const containerStyle: React.CSSProperties = useMemo(() => ({
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: bodyFont,
    fontWeight: common.fontWeight,
    color: ink,
    background: 'transparent',
    padding: 16,
  }), [bodyFont, common.textSizeMultiplier, common.fontWeight, ink]);

  const frameStyle: React.CSSProperties = useMemo(() => ({
    flex: 1,
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    backgroundColor: hexToRgba(bgColor, common.backgroundOpacity),
    border: `${borderWidth}px solid ${withOpacity(ink, common.borderOpacity)}`,
    borderRadius: 0,
    padding: 20,
    // Tilt is a static layout choice (not an animation), so we apply it
    // regardless of `reducedMotion` — users have explicitly requested tilt
    // via `tiltAngle` and the brutalist theme falls apart without it.
    transform: tiltAngle === 0 ? undefined : `rotate(${tiltAngle}deg)`,
    transformOrigin: 'center center',
    position: 'relative',
    backdropFilter: buildBlurFilter(common.blurIntensity),
    WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
  }), [bgColor, borderWidth, ink, tiltAngle, common.backgroundOpacity, common.borderOpacity, common.blurIntensity]);

  // === Idle / no song state ===
  if (!displayTrack) {
    return (
      <div style={containerStyle}>
        <div style={frameStyle}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 12,
            }}
          >
            <TagRect
              label="NOW PLAYING"
              bg={accentColor}
              color={ink}
              borderWidth={borderWidth}
              tilt={-2}
              headingFont={headingFont}
            />
          </div>
          <div
            style={{
              fontFamily: headingFont,
              fontWeight: 900,
              fontSize: common.scale(56),
              lineHeight: 0.95,
              letterSpacing: '-2px',
              textTransform: 'uppercase',
              color: ink,
              margin: 0,
              padding: '8px 0 14px',
            }}
          >
            NO TRACK
          </div>
          <div
            style={{
              borderTop: `${borderWidth}px solid ${ink}`,
              paddingTop: 12,
              fontFamily: headingFont,
              fontWeight: 700,
              fontSize: common.scale(18),
              letterSpacing: 1,
              textTransform: 'uppercase',
              color: ink,
            }}
          >
            STANDBY. WAITING FOR INPUT.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div className={transitionClassName} style={frameStyle}>
        {/* Tag strip — no album art by design */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 14,
            flexWrap: 'wrap',
          }}
        >
          <TagRect
            label="NOW PLAYING"
            bg={accentColor}
            color={ink}
            borderWidth={borderWidth}
            tilt={-2}
            headingFont={headingFont}
          />
          {data?.isLive && (
            <TagRect
              label="LIVE"
              bg={dangerColor}
              color="#ffffff"
              borderWidth={borderWidth}
              tilt={2.5}
              headingFont={headingFont}
            />
          )}
          {displayTrack.isDonation && (
            <TagRect
              label="$ DONATION"
              bg={accentColor}
              color={ink}
              borderWidth={borderWidth}
              tilt={-1.5}
              headingFont={headingFont}
            />
          )}
          {displayTrack.isHomework && (
            <TagRect
              label="HW"
              bg={ink}
              color={accentColor}
              borderWidth={borderWidth}
              tilt={1.5}
              headingFont={headingFont}
            />
          )}

          {displayTrack.isRandom && (
            <TagRect
              label="RND"
              bg={ink}
              color={accentColor}
              borderWidth={borderWidth}
              tilt={1.5}
              headingFont={headingFont}
            />
          )}
        </div>

        {/* BIG title */}
        <h3
          style={{
            fontFamily: headingFont,
            fontWeight: 900,
            fontSize: `clamp(${common.scale(28)}px, 6vw, ${common.scale(36)}px)`,
            lineHeight: 0.95,
            letterSpacing: '-1.5px',
            textTransform: 'uppercase',
            color: ink,
            margin: 0,
            padding: '4px 0 14px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            wordBreak: 'break-word',
          }}
        >
          {displayTrack.title}
        </h3>

        {/* Divider before artist */}
        <div
          style={{
            borderTop: `${borderWidth}px solid ${ink}`,
            paddingTop: 12,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                fontFamily: headingFont,
                fontWeight: 700,
                fontSize: common.scale(14),
                letterSpacing: 2,
                textTransform: 'uppercase',
                backgroundColor: ink,
                color: bgColor,
                padding: '2px 8px',
              }}
            >
              BY
            </span>
            <span
              style={{
                fontFamily: headingFont,
                fontWeight: 900,
                fontSize: common.scale(25),
                letterSpacing: -0.5,
                textTransform: 'uppercase',
                color: ink,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
                flex: 1,
              }}
            >
              {displayTrack.artist}
            </span>
            {data.settings?.showRequesterName !== false && displayTrack.requesterNickname ? (
              <span
                style={{
                  fontFamily: headingFont,
                  fontWeight: 700,
                  fontSize: common.scale(17),
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                  color: ink,
                  opacity: 0.6,
                  whiteSpace: 'nowrap',
                }}
              >
                {' '}· @{displayTrack.requesterNickname}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A rotated rectangle tag. Used for "NOW PLAYING", "LIVE", "HW", etc.
 * Brutalist rule: everything rectangular, no border-radius, hard drop shadow,
 * transform: rotate on tilt.
 */
function TagRect({
  label,
  bg,
  color,
  borderWidth,
  tilt,
  headingFont,
}: {
  label: string;
  bg: string;
  color: string;
  borderWidth: number;
  tilt: number;
  headingFont: string;
}) {
  return (
    <span
      style={{
        display: 'inline-block',
        fontFamily: headingFont,
        fontWeight: 900,
        fontSize: 14,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        backgroundColor: bg,
        color,
        padding: '4px 10px',
        border: `${Math.max(2, borderWidth - 1)}px solid #000`,
        boxShadow: `3px 3px 0 #000`,
        transform: `rotate(${tilt}deg)`,
        transformOrigin: 'center center',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}
NowPlaying.displayName = 'NowPlaying';
export default memo(NowPlaying);
