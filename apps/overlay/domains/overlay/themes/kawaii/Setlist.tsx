'use client';

import { useMemo, memo} from 'react';
import type { ThemeWidgetProps } from '../types';
import { buildFontFamilyValue, useCommonOptions } from '../shared';
import { hexToRgba, withOpacity, buildBlurFilter } from '../shared/apply-transparency';
import { defaultOptions, type KawaiiOptions } from './config';
import {
  SetlistHeader,
  SetlistNowPlaying,
  SetlistBody,
  SetlistAutoScroll,
} from '@/domains/overlay/components/setlist';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): KawaiiOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<KawaiiOptions>),
  };
}

function clampRadius(value: number): number {
  if (Number.isNaN(value)) return 20;
  return Math.max(8, Math.min(32, value));
}

function decorationGlyph(style: KawaiiOptions['decorationStyle']): string {
  switch (style) {
    case 'hearts':
      return '\u2665';
    case 'sparkles':
      return '\u2728';
    case 'stars':
    default:
      return '\u2605';
  }
}

function Setlist({
  data,
  options: rawOptions,
  fonts,
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

  const setlistData = useMemo(() => data?.setlist ?? [], [data?.setlist]);
  const nowPlaying = useMemo(
    () => setlistData.find((s) => s.status === 'PLAYING') ?? data?.nowPlaying,
    [setlistData, data?.nowPlaying],
  );
  const settings = data?.settings;

  const mainColor = options.mainColor || '#ffb6d9';
  const accentColor = common.accentColor ?? options.accentColor ?? '#b088f9';
  const bgColor = options.backgroundColor || '#fff5fa';
  const textColor = common.textColor ?? options.textColor ?? '#d63384';
  const borderRadius = clampRadius(options.borderRadius);
  const deco = decorationGlyph(options.decorationStyle);

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
    padding: 18,
    borderRadius,
    backgroundColor: hexToRgba(bgColor, common.backgroundOpacity),
    border: `3px solid ${withOpacity(mainColor, common.borderOpacity)}`,
    overflow: 'hidden',
    backdropFilter: buildBlurFilter(common.blurIntensity),
    WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
  }), [bgColor, borderRadius, mainColor, common.backgroundOpacity, common.borderOpacity, common.blurIntensity]);

  const headerStyle: React.CSSProperties = useMemo(() => ({
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    fontFamily: headingFont,
    fontSize: common.scale(20),
    fontWeight: 700,
    color: textColor,
  }), [headingFont, textColor, common.textSizeMultiplier]);

  const nowPlayingStyle: React.CSSProperties = useMemo(() => ({
    padding: '10px 14px',
    marginBottom: 12,
    borderRadius: Math.max(6, borderRadius - 6),
    backgroundColor: `${mainColor}33`,
    border: `2px solid ${accentColor}`,
    boxShadow: `0 2px 8px rgba(255, 182, 217, 0.25)`,
    fontFamily: headingFont,
    fontSize: common.scale(18),
    fontWeight: 700,
    color: textColor,
  }), [accentColor, borderRadius, headingFont, mainColor, textColor, common.textSizeMultiplier]);

  const bodyStyle: React.CSSProperties = useMemo(() => ({
    fontSize: common.scale(16),
    lineHeight: 1.8,
    fontFamily: bodyFont,
    color: textColor,
  }), [bodyFont, textColor, common]);

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

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={headerStyle}>
          <span aria-hidden="true" style={{ fontSize: common.scale(14), color: accentColor }}>{deco}</span>
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
          <span aria-hidden="true" style={{ fontSize: common.scale(14), color: mainColor }}>{deco}</span>
        </div>

        <div style={nowPlayingStyle}>
          <SetlistNowPlaying
            nowPlaying={nowPlaying}
            textColor={textColor}
            accentColor={accentColor}
            fontFamily={bodyFont}
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
                ((rawOptions as Record<string, unknown>)?.donationColor as string) ?? '#b088f9'
              }
            />
          </div>
        </SetlistAutoScroll>

        <div aria-hidden="true" style={underlineStyle} />
      </div>
    </div>
  );
}
Setlist.displayName = 'Setlist';
export default memo(Setlist);
