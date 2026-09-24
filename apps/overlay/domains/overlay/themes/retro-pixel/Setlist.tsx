'use client';

import { useMemo, memo} from 'react';
import type { ThemeWidgetProps } from '../types';
import { buildFontFamilyValue, useCommonOptions } from '../shared';
import { hexToRgba, withOpacity, buildBlurFilter } from '../shared/apply-transparency';
import { defaultOptions, type RetroPixelOptions } from './config';
import {
  SetlistHeader,
  SetlistNowPlaying,
  SetlistBody,
  SetlistAutoScroll,
} from '@/domains/overlay/components/setlist';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): RetroPixelOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<RetroPixelOptions>),
  };
}

function clampGlow(intensity: number): number {
  if (Number.isNaN(intensity)) return 60;
  return Math.max(0, Math.min(100, intensity));
}

function Setlist({
  data,
  options: rawOptions,
  fonts,
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

  const setlistData = useMemo(() => data?.setlist ?? [], [data?.setlist]);
  const nowPlaying = useMemo(
    () => setlistData.find((s) => s.status === 'PLAYING') ?? data?.nowPlaying,
    [setlistData, data?.nowPlaying],
  );
  const settings = data?.settings;

  const glow = clampGlow(options.glowIntensity);
  const glowAlpha = 0.35 + (glow / 100) * 0.55;
  const glowBlur = 6 + (glow / 100) * 18;
  const borderColor = options.primaryColor;
  const accentColor = common.accentColor ?? options.accentColor;
  const bodyTextColor = common.textColor ?? accentColor;
  const bgColor = options.backgroundColor;
  const pixelScale = Math.max(1, Math.min(4, options.pixelScale ?? 2));
  const borderWidth = pixelScale * 2;

  const containerStyle: React.CSSProperties = useMemo(() => ({
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: bodyFont,
    fontWeight: common.fontWeight,
    color: bodyTextColor,
    background: 'transparent',
  }), [bodyFont, bodyTextColor, common.textSizeMultiplier, common.fontWeight]);

  const frameStyle: React.CSSProperties = useMemo(() => ({
    flex: 1,
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: hexToRgba(bgColor, common.backgroundOpacity),
    border: `${borderWidth}px solid ${withOpacity(borderColor, common.borderOpacity)}`,
    borderRadius: 0,
    padding: pixelScale * 8,
    position: 'relative',
    boxShadow: `0 0 0 ${pixelScale}px rgba(0, 0, 0, 0.85)`,
    overflow: 'hidden',
    imageRendering: 'pixelated',
    backdropFilter: buildBlurFilter(common.blurIntensity),
    WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
  }), [bgColor, borderColor, borderWidth, pixelScale, common.backgroundOpacity, common.borderOpacity, common.blurIntensity]);

  const headerStyle: React.CSSProperties = useMemo(() => ({
    fontFamily: headingFont,
    color: borderColor,
    fontSize: common.scale(18),
    letterSpacing: 2,
    paddingBottom: pixelScale * 4,
    marginBottom: pixelScale * 6,
    borderBottom: `${pixelScale}px dashed ${accentColor}`,
    textShadow: `0 0 ${glowBlur * 0.6}px rgba(255, 110, 199, ${glowAlpha}), 2px 2px 0 rgba(0, 0, 0, 0.85)`,
    textTransform: 'uppercase',
  }), [accentColor, borderColor, glowAlpha, glowBlur, headingFont, pixelScale, common.textSizeMultiplier]);

  const nowPlayingStyle: React.CSSProperties = useMemo(() => ({
    padding: `${pixelScale * 4}px ${pixelScale * 6}px`,
    marginBottom: pixelScale * 6,
    backgroundColor: `${borderColor}22`,
    border: `${pixelScale}px solid ${borderColor}`,
    fontFamily: headingFont,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: borderColor,
    textShadow: `0 0 ${glowBlur * 0.6}px rgba(255, 110, 199, ${glowAlpha}), 2px 2px 0 rgba(0, 0, 0, 0.85)`,
  }), [borderColor, glowAlpha, glowBlur, headingFont, pixelScale]);

  const bodyStyle: React.CSSProperties = useMemo(() => ({
    fontSize: common.scale(16),
    lineHeight: 1.8,
    fontFamily: bodyFont,
    color: accentColor,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  }), [accentColor, bodyFont, common]);

  return (
    <div style={containerStyle}>
      <div style={frameStyle}>
        {options.showScanlines && <ScanlinesOverlay />}

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
            textColor={borderColor}
            accentColor={accentColor}
            fontFamily={headingFont}
            baseFontSize={14}
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
                ((rawOptions as Record<string, unknown>)?.donationColor as string) ?? '#ff6ec7'
              }
            />
          </div>
        </SetlistAutoScroll>
      </div>
    </div>
  );
}

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
Setlist.displayName = 'Setlist';
export default memo(Setlist);
