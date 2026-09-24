'use client';

import { useMemo, memo} from 'react';
import type { ThemeWidgetProps } from '../types';
import { buildFontFamilyValue, useCommonOptions } from '../shared';
import { hexToRgba, withOpacity, buildBlurFilter } from '../shared/apply-transparency';
import { defaultOptions, type VinylAnalogOptions } from './config';
import {
  SetlistHeader,
  SetlistNowPlaying,
  SetlistBody,
  SetlistAutoScroll,
} from '@/domains/overlay/components/setlist';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): VinylAnalogOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<VinylAnalogOptions>),
  };
}

function Setlist({
  data,
  options: rawOptions,
  fonts,
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

  const setlistData = useMemo(() => data?.setlist ?? [], [data?.setlist]);
  const nowPlaying = useMemo(
    () => setlistData.find((s) => s.status === 'PLAYING') ?? data?.nowPlaying,
    [setlistData, data?.nowPlaying],
  );
  const settings = data?.settings;

  const accentColor = common.accentColor ?? options.accentColor ?? defaultOptions.accentColor;
  const bgColor = options.backgroundColor || defaultOptions.backgroundColor;
  const textColor = common.textColor ?? options.textColor ?? defaultOptions.textColor;

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

  const frameStyle: React.CSSProperties = useMemo(() => ({
    flex: 1,
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: hexToRgba(bgColor, common.backgroundOpacity),
    backgroundImage: [
      `radial-gradient(ellipse at 30% 20%, rgba(255, 220, 180, 0.08), transparent 55%)`,
      `repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.05) 0px, rgba(0, 0, 0, 0.05) 1px, transparent 1px, transparent 5px)`,
    ].join(', '),
    border: `1px solid ${withOpacity(accentColor, common.borderOpacity * 0.25)}`,
    borderRadius: 12,
    padding: '22px 26px',
    position: 'relative',
    boxShadow: [
      'inset 0 1px 0 rgba(255, 230, 190, 0.08)',
      'inset 0 0 40px rgba(0, 0, 0, 0.45)',
    ].join(', '),
    overflow: 'hidden',
    boxSizing: 'border-box',
    backdropFilter: buildBlurFilter(common.blurIntensity),
    WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
  }), [accentColor, bgColor, common.backgroundOpacity, common.borderOpacity, common.blurIntensity]);

  const headerStyle: React.CSSProperties = useMemo(() => ({
    fontFamily: accentFont,
    fontSize: common.scale(13),
    fontStyle: 'italic',
    letterSpacing: 3,
    textTransform: 'uppercase',
    color: accentColor,
    marginBottom: 14,
    paddingBottom: 10,
    borderBottom: `1px solid ${accentColor}33`,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  }), [accentColor, accentFont, common.textSizeMultiplier]);

  const nowPlayingStyle: React.CSSProperties = useMemo(() => ({
    padding: '10px 14px',
    marginBottom: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.22)',
    border: `1px solid ${accentColor}44`,
    borderRadius: 6,
    fontFamily: headingFont,
    fontSize: common.scale(16),
    fontWeight: 700,
    color: textColor,
  }), [accentColor, headingFont, textColor, common.textSizeMultiplier]);

  const bodyStyle: React.CSSProperties = useMemo(() => ({
    fontSize: common.scale(14),
    lineHeight: 1.8,
    fontFamily: bodyFont,
    fontStyle: 'italic',
    color: textColor,
  }), [bodyFont, textColor, common]);

  return (
    <div style={containerStyle}>
      <div style={frameStyle}>
        <div style={headerStyle}>
          <span aria-hidden="true">{'\u266B'}</span>
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
            textColor={textColor}
            accentColor={accentColor}
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
                ((rawOptions as Record<string, unknown>)?.donationColor as string) ?? '#c4956a'
              }
            />
          </div>
        </SetlistAutoScroll>
      </div>
    </div>
  );
}
Setlist.displayName = 'Setlist';
export default memo(Setlist);
