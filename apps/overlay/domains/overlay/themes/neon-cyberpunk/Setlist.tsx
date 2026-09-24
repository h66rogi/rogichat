'use client';

import { useMemo, memo} from 'react';
import type { ThemeWidgetProps } from '../types';
import { buildFontFamilyValue, useCommonOptions } from '../shared';
import { hexToRgba, buildBlurFilter } from '../shared/apply-transparency';
import { defaultOptions, type NeonCyberpunkOptions } from './config';
import {
  SetlistHeader,
  SetlistNowPlaying,
  SetlistBody,
  SetlistAutoScroll,
} from '@/domains/overlay/components/setlist';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): NeonCyberpunkOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<NeonCyberpunkOptions>),
  };
}

function clampGlow(intensity: number): number {
  if (Number.isNaN(intensity)) return 75;
  return Math.max(0, Math.min(100, intensity));
}

function hexToRgbTriplet(hex: string, fallback = '255, 0, 255'): string {
  const match = hex.trim().match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!match) return fallback;
  const r = parseInt(match[1], 16);
  const g = parseInt(match[2], 16);
  const b = parseInt(match[3], 16);
  return `${r}, ${g}, ${b}`;
}

function Setlist({
  data,
  options: rawOptions,
  fonts,
}: Props) {
  const options = useMemo(() => resolveOptions(rawOptions), [rawOptions]);
  const common = useCommonOptions(rawOptions);
  const headingFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.heading ?? ['Orbitron', 'sans-serif']),
    [common.fontFamily, fonts.roles.heading],
  );
  const bodyFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['Rajdhani', 'sans-serif']),
    [common.fontFamily, fonts.roles.body],
  );
  const accentFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.accent ?? ['Orbitron', 'monospace']),
    [common.fontFamily, fonts.roles.accent],
  );

  const setlistData = useMemo(() => data?.setlist ?? [], [data?.setlist]);
  const nowPlaying = useMemo(
    () => setlistData.find((s) => s.status === 'PLAYING') ?? data?.nowPlaying,
    [setlistData, data?.nowPlaying],
  );
  const settings = data?.settings;

  const glow = clampGlow(options.glowIntensity);
  const glowScale = 0.2 + (glow / 100) * 0.9;

  const primaryNeon = common.accentColor ?? options.primaryNeon ?? '#ff00ff';
  const secondaryNeon = common.textColor ?? options.secondaryNeon ?? '#00fff7';
  const bgColor = options.backgroundColor || '#05000a';

  const primaryRgb = hexToRgbTriplet(primaryNeon, '255, 0, 255');
  const secondaryRgb = hexToRgbTriplet(secondaryNeon, '0, 255, 247');

  const buildNeonTextShadow = (rgbTriplet: string, scale: number) => {
    const inner = `0 0 ${10 * scale}px rgba(${rgbTriplet}, ${Math.min(1, 0.95 * scale)})`;
    const mid = `0 0 ${20 * scale}px rgba(${rgbTriplet}, ${Math.min(1, 0.7 * scale)})`;
    const outer = `0 0 ${36 * scale}px rgba(${rgbTriplet}, ${Math.min(1, 0.45 * scale)})`;
    return `${inner}, ${mid}, ${outer}`;
  };

  const primaryShadow = buildNeonTextShadow(primaryRgb, glowScale);
  const secondaryShadow = buildNeonTextShadow(secondaryRgb, glowScale * 0.65);

  const containerStyle: React.CSSProperties = useMemo(() => ({
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: bodyFont,
    fontWeight: common.fontWeight,
    color: secondaryNeon,
    background: 'transparent',
  }), [bodyFont, common.textSizeMultiplier, common.fontWeight, secondaryNeon]);

  const frameStyle: React.CSSProperties = useMemo(() => {
    const rgb = hexToRgbTriplet(primaryNeon, '255, 0, 255');
    return {
      flex: 1,
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      padding: '16px 18px',
      backgroundColor: hexToRgba(bgColor, common.backgroundOpacity),
      border: `1px solid rgba(${rgb}, ${0.35 * common.borderOpacity})`,
      boxShadow: `inset 0 0 ${26 * glowScale}px rgba(${rgb}, ${0.08 * glowScale})`,
      borderRadius: 2,
      overflow: 'hidden',
      backdropFilter: buildBlurFilter(common.blurIntensity),
      WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
    };
  }, [bgColor, glowScale, primaryNeon, common.backgroundOpacity, common.borderOpacity, common.blurIntensity]);

  const headerStyle: React.CSSProperties = useMemo(() => ({
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
    paddingBottom: 10,
    borderBottom: `1px solid rgba(${secondaryRgb}, 0.3)`,
    fontFamily: accentFont,
    fontSize: common.scale(12),
    letterSpacing: 3,
    textTransform: 'uppercase',
    color: primaryNeon,
    textShadow: primaryShadow,
  }), [accentFont, primaryNeon, primaryShadow, secondaryRgb, common.textSizeMultiplier]);

  const nowPlayingStyle: React.CSSProperties = useMemo(() => {
    const pRgb = hexToRgbTriplet(primaryNeon, '255, 0, 255');
    const sRgb = hexToRgbTriplet(secondaryNeon, '0, 255, 247');
    return {
      padding: '10px 12px',
      marginBottom: 12,
      backgroundImage: `linear-gradient(90deg, rgba(${pRgb}, 0.08) 0%, rgba(${pRgb}, 0.18) 50%, rgba(${pRgb}, 0.08) 100%)`,
      borderBottom: `1px solid rgba(${sRgb}, 0.18)`,
      fontFamily: headingFont,
      fontSize: common.scale(15),
      fontWeight: 700,
      color: '#ffffff',
      textShadow: `0 0 ${6 * glowScale}px rgba(255, 255, 255, ${0.4 * glowScale})`,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    };
  }, [glowScale, headingFont, primaryNeon, secondaryNeon, common.textSizeMultiplier]);

  const bodyStyle: React.CSSProperties = useMemo(() => ({
    fontSize: common.scale(14),
    lineHeight: 1.8,
    fontFamily: bodyFont,
    color: secondaryNeon,
    textShadow: secondaryShadow,
    letterSpacing: 0.3,
  }), [bodyFont, secondaryNeon, secondaryShadow, common]);

  const topLine: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    background: `linear-gradient(90deg, rgba(${primaryRgb}, 0) 0%, rgba(${primaryRgb}, 1) 50%, rgba(${secondaryRgb}, 0) 100%)`,
    boxShadow: `0 0 ${8 * glowScale}px rgba(${primaryRgb}, ${0.8 * glowScale})`,
    pointerEvents: 'none',
  };

  const bottomLine: React.CSSProperties = {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 1,
    background: `linear-gradient(90deg, rgba(${secondaryRgb}, 0) 0%, rgba(${secondaryRgb}, 1) 50%, rgba(${primaryRgb}, 0) 100%)`,
    boxShadow: `0 0 ${8 * glowScale}px rgba(${secondaryRgb}, ${0.8 * glowScale})`,
    pointerEvents: 'none',
  };

  return (
    <div style={containerStyle}>
      <div style={frameStyle}>
        {options.showScanlines && <ScanlineOverlay />}
        <div aria-hidden="true" style={topLine} />
        <div aria-hidden="true" style={bottomLine} />

        <div style={headerStyle}>
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: primaryNeon,
              boxShadow: `0 0 6px ${primaryNeon}, 0 0 12px ${primaryNeon}`,
              flexShrink: 0,
            }}
          />
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
            textColor={secondaryNeon}
            accentColor={primaryNeon}
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
                ((rawOptions as Record<string, unknown>)?.donationColor as string) ?? '#ff00ff'
              }
            />
          </div>
        </SetlistAutoScroll>
      </div>
    </div>
  );
}

function ScanlineOverlay() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        backgroundImage:
          'repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.32) 0, rgba(0, 0, 0, 0.32) 1px, transparent 1px, transparent 3px)',
        mixBlendMode: 'multiply',
        opacity: 0.7,
      }}
    />
  );
}
Setlist.displayName = 'Setlist';
export default memo(Setlist);
