'use client';

import { useMemo, memo} from 'react';
import type { ThemeWidgetProps } from '../types';
import { buildFontFamilyValue, useCommonOptions } from '../shared';
import { buildBlurFilter } from '../shared/apply-transparency';
import { defaultOptions, type ThreeDDepthOptions } from './config';
import {
  SetlistHeader,
  SetlistNowPlaying,
  SetlistBody,
  SetlistAutoScroll,
} from '@/domains/overlay/components/setlist';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): ThreeDDepthOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<ThreeDDepthOptions>),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function hexToRgbTriplet(hex: string, fallback = '30, 41, 59'): string {
  const match = hex.trim().match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!match) return fallback;
  const r = parseInt(match[1], 16);
  const g = parseInt(match[2], 16);
  const b = parseInt(match[3], 16);
  return `${r}, ${g}, ${b}`;
}

function lighten(rgbTriplet: string, amount: number): string {
  const [r, g, b] = rgbTriplet.split(',').map((p) => parseInt(p.trim(), 10));
  const lift = (v: number) => Math.round(v + (255 - v) * amount);
  return `${lift(r)}, ${lift(g)}, ${lift(b)}`;
}

function Setlist({
  data,
  options: rawOptions,
  fonts,
}: Props) {
  const options = useMemo(() => resolveOptions(rawOptions), [rawOptions]);
  const common = useCommonOptions(rawOptions);
  const headingFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.heading ?? ['Inter', 'sans-serif']),
    [common.fontFamily, fonts.roles.heading],
  );
  const bodyFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['Poppins', 'sans-serif']),
    [common.fontFamily, fonts.roles.body],
  );

  const setlistData = useMemo(() => data?.setlist ?? [], [data?.setlist]);
  const nowPlaying = useMemo(
    () => setlistData.find((s) => s.status === 'PLAYING') ?? data?.nowPlaying,
    [setlistData, data?.nowPlaying],
  );
  const settings = data?.settings;

  const perspective = clamp(options.perspective, 400, 1200);
  const rotateY = clamp(options.rotateY, -20, 20);
  const rotateX = clamp(options.rotateX, -20, 20);
  const shadowDepth = clamp(options.shadowDepth, 8, 40);

  const baseColor = options.baseColor || '#1e293b';
  const accentColor = common.accentColor ?? options.accentColor ?? '#6366f1';
  const highlightColor = options.highlightColor || '#a78bfa';
  const textColor = common.textColor ?? options.textColor ?? '#ffffff';

  const accentRgb = hexToRgbTriplet(accentColor, '99, 102, 241');

  const shadowScale = shadowDepth / 20;
  const cardShadow = [
    `${Math.round(25 * shadowScale)}px ${Math.round(25 * shadowScale)}px ${Math.round(60 * shadowScale)}px rgba(0, 0, 0, 0.5)`,
    `-${Math.round(4 * shadowScale)}px -${Math.round(4 * shadowScale)}px ${Math.round(15 * shadowScale)}px rgba(255, 255, 255, 0.02)`,
    `0 0 ${Math.round(28 * shadowScale)}px rgba(${accentRgb}, 0.08)`,
  ].join(', ');

  const containerStyle: React.CSSProperties = useMemo(() => ({
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: bodyFont,
    fontWeight: common.fontWeight,
    color: textColor,
    background: 'transparent',
    perspective: `${perspective}px`,
    perspectiveOrigin: '50% 40%',
    position: 'relative',
    overflow: 'visible',
    padding: 16,
  }), [bodyFont, common.textSizeMultiplier, common.fontWeight, textColor, perspective]);

  const frameStyle: React.CSSProperties = useMemo(() => {
    const rgb = hexToRgbTriplet(baseColor, '30, 41, 59');
    const lighter = lighten(rgb, 0.14);
    return {
      position: 'relative',
      flex: 1,
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      padding: '20px 22px',
      borderRadius: 20,
      background: `linear-gradient(135deg, rgba(${lighter}, ${common.backgroundOpacity}) 0%, rgba(${rgb}, ${common.backgroundOpacity}) 100%)`,
      border: `1px solid rgba(255, 255, 255, ${0.05 * common.borderOpacity})`,
      transform: `rotateY(${rotateY}deg) rotateX(${rotateX}deg)`,
      transformStyle: 'preserve-3d',
      transformOrigin: 'center center',
      willChange: 'transform',
      backdropFilter: buildBlurFilter(common.blurIntensity),
      WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
    };
  }, [baseColor, rotateY, rotateX, common.backgroundOpacity, common.borderOpacity, common.blurIntensity]);

  const headerStyle: React.CSSProperties = useMemo(() => ({
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
    fontFamily: headingFont,
    fontSize: common.scale(16),
    fontWeight: 700,
    color: textColor,
    letterSpacing: 0.5,
    textShadow: '0 2px 6px rgba(0, 0, 0, 0.4)',
  }), [headingFont, textColor, common.textSizeMultiplier]);

  const nowPlayingStyle: React.CSSProperties = useMemo(() => {
    const rgb = hexToRgbTriplet(accentColor, '99, 102, 241');
    return {
      padding: 11,
      marginBottom: 12,
      borderRadius: 14,
      background: `linear-gradient(135deg, rgba(${rgb}, 0.32) 0%, rgba(${rgb}, 0.16) 100%)`,
      border: `1px solid rgba(${rgb}, 0.45)`,
      boxShadow: `8px 10px 22px rgba(0, 0, 0, 0.45), 0 0 22px rgba(${rgb}, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.08)`,
      fontFamily: headingFont,
      fontSize: common.scale(16),
      fontWeight: 700,
      color: textColor,
      textShadow: '0 1px 3px rgba(0, 0, 0, 0.4)',
    };
  }, [accentColor, headingFont, textColor, common.textSizeMultiplier]);

  const bodyStyle: React.CSSProperties = useMemo(() => ({
    fontSize: common.scale(14),
    lineHeight: 1.8,
    fontFamily: bodyFont,
    color: highlightColor,
    opacity: 0.7,
  }), [bodyFont, highlightColor, common]);

  return (
    <div style={containerStyle}>
      <div style={frameStyle}>
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
                ((rawOptions as Record<string, unknown>)?.donationColor as string) ?? '#a78bfa'
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
