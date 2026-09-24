'use client';

import { useMemo, memo} from 'react';
import type { ThemeWidgetProps } from '../types';
import { buildFontFamilyValue, useCommonOptions } from '../shared';
import { hexToRgba, buildBlurFilter } from '../shared/apply-transparency';
import { defaultOptions, type KoreanTraditionalOptions } from './config';
import {
  SetlistHeader,
  SetlistNowPlaying,
  SetlistBody,
  SetlistAutoScroll,
} from '@/domains/overlay/components/setlist';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): KoreanTraditionalOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<KoreanTraditionalOptions>),
  };
}

function withAlpha(hex: string, alpha: number): string {
  if (!hex.startsWith('#') || hex.length !== 7) return hex;
  const a = Math.max(0, Math.min(255, Math.round(alpha))).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

function Setlist({
  data,
  options: rawOptions,
  fonts,
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

  const setlistData = useMemo(() => data?.setlist ?? [], [data?.setlist]);
  const nowPlaying = useMemo(
    () => setlistData.find((s) => s.status === 'PLAYING') ?? data?.nowPlaying,
    [setlistData, data?.nowPlaying],
  );
  const settings = data?.settings;

  const baseColor = options.baseColor || defaultOptions.baseColor;
  const inkColor = common.textColor ?? options.inkColor ?? defaultOptions.inkColor;
  const accentRed = common.accentColor ?? options.accentRed ?? defaultOptions.accentRed;
  const accentBrown = options.accentBrown || defaultOptions.accentBrown;

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

  const paperStyle: React.CSSProperties = useMemo(() => ({
    flex: 1,
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: hexToRgba(baseColor, common.backgroundOpacity),
    backgroundImage: [
      `radial-gradient(ellipse at 20% 15%, rgba(255, 255, 255, ${0.45 * common.backgroundOpacity}), transparent 55%)`,
      `radial-gradient(ellipse at 80% 85%, ${hexToRgba(accentBrown, (22 / 255) * common.backgroundOpacity)}, transparent 60%)`,
      `repeating-radial-gradient(circle at 30% 40%, ${hexToRgba(inkColor, (8 / 255) * common.backgroundOpacity)} 0, ${hexToRgba(inkColor, (8 / 255) * common.backgroundOpacity)} 1px, transparent 1px, transparent 6px)`,
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
    padding: '20px 14px 22px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 12,
    textAlign: 'center',
  }), []);

  const headerStyle: React.CSSProperties = useMemo(() => ({
    fontFamily: bodyFont,
    fontSize: common.scale(13),
    letterSpacing: 4,
    color: accentBrown,
    margin: 0,
    paddingBottom: 10,
    borderBottom: `1px solid ${withAlpha(accentBrown, 80)}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  }), [accentBrown, bodyFont, common.textSizeMultiplier]);

  const nowPlayingStyle: React.CSSProperties = useMemo(() => ({
    padding: '10px 12px',
    borderBottom: `1px dashed ${withAlpha(accentBrown, 70)}`,
    fontFamily: headingFont,
    fontSize: common.scale(16),
    fontWeight: 700,
    color: inkColor,
    textAlign: 'center',
  }), [accentBrown, headingFont, inkColor, common.textSizeMultiplier]);

  const bodyStyle: React.CSSProperties = useMemo(() => ({
    fontSize: common.scale(14),
    lineHeight: 1.8,
    fontFamily: bodyFont,
    color: inkColor,
    textAlign: 'center',
  }), [bodyFont, inkColor, common]);

  return (
    <div style={containerStyle}>
      <div style={paperStyle}>
        <div style={innerBorderStyle} aria-hidden="true" />
        <div style={innerContentStyle}>
          <div style={headerStyle}>
            <SetlistHeader
              requestEnabled={settings?.requestEnabled ?? false}
              paused={settings?.paused ?? false}
              donationEnabled={settings?.donationPriorityEnabled ?? false}
              setlist={setlistData}
              showRequestMethods={(rawOptions as Record<string, unknown>)?.showRequestMethods !== false}
              rotationIntervalMs={
                (rawOptions as Record<string, unknown>)?.rotationInterval as number | undefined
              }
            />
          </div>

          <div style={nowPlayingStyle}>
            <SetlistNowPlaying
              nowPlaying={nowPlaying}
              textColor={inkColor}
              accentColor={accentRed}
              fontFamily={headingFont}
              baseFontSize={16}
              textSizeMultiplier={common.textSizeMultiplier}
              showAlbumArt={(rawOptions as Record<string, unknown>)?.showAlbumArt !== false}
            />
          </div>

          <SetlistAutoScroll
            threshold={
              ((rawOptions as Record<string, unknown>)?.autoScrollThreshold as number) ?? 600
            }
          >
            <div style={bodyStyle}>
              <SetlistBody
                setlist={setlistData}
                separator={
                  ((rawOptions as Record<string, unknown>)?.separator as string) ?? ' / '
                }
                completedOpacity={
                  ((rawOptions as Record<string, unknown>)?.completedOpacity as number) ?? 0.3
                }
                donationColor={
                  ((rawOptions as Record<string, unknown>)?.donationColor as string) ?? '#c0392b'
                }
              />
            </div>
          </SetlistAutoScroll>
        </div>
      </div>
    </div>
  );
}
Setlist.displayName = 'Setlist';
export default memo(Setlist);
