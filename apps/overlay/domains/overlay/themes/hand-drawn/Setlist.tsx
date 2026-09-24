'use client';

import { useMemo, memo} from 'react';
import type { ThemeWidgetProps } from '../types';
import { buildFontFamilyValue, useCommonOptions } from '../shared';
import { hexToRgba, withOpacity, buildBlurFilter } from '../shared/apply-transparency';
import { defaultOptions, type HandDrawnOptions } from './config';
import {
  SetlistHeader,
  SetlistNowPlaying,
  SetlistBody,
  SetlistAutoScroll,
} from '@/domains/overlay/components/setlist';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): HandDrawnOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<HandDrawnOptions>),
  };
}

function clampRoughness(value: number): number {
  if (Number.isNaN(value)) return 2;
  return Math.max(1, Math.min(4, value));
}

function Setlist({
  data,
  options: rawOptions,
  fonts,
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

  const setlistData = useMemo(() => data?.setlist ?? [], [data?.setlist]);
  const nowPlaying = useMemo(
    () => setlistData.find((s) => s.status === 'PLAYING') ?? data?.nowPlaying,
    [setlistData, data?.nowPlaying],
  );
  const settings = data?.settings;

  const paperColor = options.paperColor || '#faf5eb';
  const inkColor = common.textColor ?? options.inkColor ?? '#2c2c2c';
  const accentColor = common.accentColor ?? options.accentColor ?? '#ff6b6b';
  const highlightColor = options.highlightColor || '#ffeb3b';
  const roughness = clampRoughness(options.borderRoughness);
  const showTape = options.showTape !== false;

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
    padding: '24px 22px 20px 22px',
    backgroundColor: hexToRgba(paperColor, common.backgroundOpacity),
    backgroundImage: `repeating-linear-gradient(
      to bottom,
      transparent 0px,
      transparent 24px,
      ${inkColor}10 24px,
      ${inkColor}10 25px
    )`,
    borderRadius: 6 + roughness,
    border: `${roughness}px solid ${withOpacity(inkColor, common.borderOpacity)}`,
    transform: 'rotate(-0.6deg)',
    overflow: 'visible',
    backdropFilter: buildBlurFilter(common.blurIntensity),
    WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
  }), [inkColor, paperColor, roughness, common.backgroundOpacity, common.borderOpacity, common.blurIntensity]);

  const tapeStyle: React.CSSProperties = useMemo(() => ({
    position: 'absolute',
    top: -12,
    left: '50%',
    width: 90,
    height: 22,
    marginLeft: -45,
    background: `linear-gradient(180deg, ${highlightColor}cc, ${highlightColor}88)`,
    border: `1px solid ${inkColor}33`,
    transform: 'rotate(-3deg)',
    boxShadow: '0 2px 4px rgba(0,0,0,0.12)',
    pointerEvents: 'none',
  }), [highlightColor, inkColor]);

  const headerStyle: React.CSSProperties = useMemo(() => ({
    fontFamily: headingFont,
    fontSize: common.scale(24),
    fontWeight: 700,
    color: inkColor,
    marginBottom: 12,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 8,
    borderBottom: `${Math.max(1, roughness - 1)}px dashed ${inkColor}66`,
  }), [headingFont, inkColor, roughness, common.textSizeMultiplier]);

  const nowPlayingStyle: React.CSSProperties = useMemo(() => ({
    padding: '10px 14px',
    marginBottom: 12,
    backgroundColor: `${highlightColor}55`,
    border: `${roughness}px solid ${accentColor}`,
    borderRadius: 4 + roughness,
    boxShadow: '0 3px 8px rgba(0,0,0,0.12)',
    fontFamily: headingFont,
    fontSize: common.scale(21),
    fontWeight: 700,
    color: inkColor,
  }), [accentColor, headingFont, highlightColor, inkColor, roughness, common.textSizeMultiplier]);

  const bodyStyle: React.CSSProperties = useMemo(() => ({
    fontSize: common.scale(16),
    lineHeight: 1.8,
    fontFamily: bodyFont,
    color: inkColor,
  }), [bodyFont, inkColor, common]);

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        {showTape && <div aria-hidden="true" style={tapeStyle} />}

        <div style={headerStyle}>
          <span aria-hidden="true">{'\u{1F4D6}'}</span>
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
            accentColor={accentColor}
            fontFamily={headingFont}
            baseFontSize={18}
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
                ((rawOptions as Record<string, unknown>)?.donationColor as string) ?? '#ff6b6b'
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
