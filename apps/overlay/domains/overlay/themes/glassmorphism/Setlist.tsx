'use client';

import { useMemo, memo} from 'react';
import type { ThemeWidgetProps } from '../types';
import { buildFontFamilyValue, useCommonOptions } from '../shared';
import { defaultOptions, type GlassmorphismOptions } from './config';
import LiquidGlassFilter from './LiquidGlassFilter';
import {
  SetlistHeader,
  SetlistNowPlaying,
  SetlistBody,
  SetlistAutoScroll,
} from '@/domains/overlay/components/setlist';

const LIQUID_FILTER_ID = 'liquid-glass-setlist';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): GlassmorphismOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<GlassmorphismOptions>),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
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
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['Pretendard', 'sans-serif']),
    [common.fontFamily, fonts.roles.body],
  );

  const setlistData = useMemo(() => data?.setlist ?? [], [data?.setlist]);
  const nowPlaying = useMemo(
    () => setlistData.find((s) => s.status === 'PLAYING') ?? data?.nowPlaying,
    [setlistData, data?.nowPlaying],
  );
  const settings = data?.settings;

  const cardOpacity = clamp(options.cardOpacity, 0, 100) / 100;
  const textColor = common.textColor ?? options.textColor ?? '#ffffff';
  const accentColor = common.accentColor ?? textColor;
  const gradientStart = options.gradientStart || '#667eea';
  const gradientEnd = options.gradientEnd || '#764ba2';

  const glassOpacity = clamp(options.glassOpacity ?? 0.28, 0.1, 0.6);
  const glassBlur = clamp(options.glassBlur ?? 20, 8, 40);

  // Common transparency controls
  const blurPx = common.blurIntensity;
  const borderOpacity = common.borderOpacity;

  const containerStyle: React.CSSProperties = useMemo(() => ({
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: bodyFont,
    fontWeight: common.fontWeight,
    color: textColor,
    background: 'transparent',
    position: 'relative',
    overflow: 'hidden',
  }), [bodyFont, common.textSizeMultiplier, common.fontWeight, textColor]);

  const frameStyle: React.CSSProperties = useMemo(() => {
    const effectiveGlassOpacity = glassOpacity * common.backgroundOpacity;
    const liquidFilter = `url(#${LIQUID_FILTER_ID}) blur(${glassBlur}px) saturate(180%)`;
    const fallbackFilter = `blur(${blurPx}px) saturate(180%)`;
    return {
      position: 'relative',
      flex: 1,
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      padding: 18,
      borderRadius: 24,
      backgroundColor: `rgba(18, 18, 24, ${effectiveGlassOpacity})`,
      backdropFilter: liquidFilter,
      WebkitBackdropFilter: fallbackFilter,
      border: `1.5px solid rgba(255, 255, 255, ${0.32 * borderOpacity})`,
      boxShadow: [
        `inset 0 1.5px 0 rgba(255, 255, 255, ${0.72 * common.backgroundOpacity})`,
        `inset 0 -1px 0 rgba(0, 0, 0, ${0.22 * common.backgroundOpacity})`,
        `inset 1.5px 0 0 rgba(255, 255, 255, ${0.22 * common.backgroundOpacity})`,
        `inset -1.5px 0 0 rgba(255, 255, 255, ${0.22 * common.backgroundOpacity})`,
      ].join(', '),
      overflow: 'hidden',
    };
  }, [glassBlur, glassOpacity, blurPx, borderOpacity, common.backgroundOpacity]);

  const specularStyle: React.CSSProperties = useMemo(() => ({
    position: 'absolute',
    inset: 0,
    borderRadius: 24,
    pointerEvents: 'none',
    zIndex: 0,
    background: [
      'radial-gradient(ellipse 75% 50% at 18% 6%, rgba(255,255,255,0.58) 0%, rgba(255,255,255,0.22) 26%, rgba(255,255,255,0) 58%)',
      'radial-gradient(ellipse 50% 32% at 88% 92%, rgba(255,255,255,0.26) 0%, rgba(255,255,255,0) 64%)',
      'linear-gradient(135deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 38%, rgba(255,255,255,0) 68%, rgba(255,255,255,0.12) 100%)',
    ].join(', '),
    mixBlendMode: 'overlay',
  }), []);

  const contentLayerStyle: React.CSSProperties = useMemo(() => ({
    position: 'relative',
    zIndex: 1,
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
  }), []);

  const headerStyle: React.CSSProperties = useMemo(() => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 14,
    fontFamily: headingFont,
    fontSize: common.scale(16),
    fontWeight: 700,
    letterSpacing: 0.5,
  }), [headingFont, common.textSizeMultiplier]);

  // Inner now-playing card uses a flat translucent fill — the outer frame
  // already has backdrop-filter blur, so a second nested blur is wasted
  // GPU work (each blur creates a new compositing surface).
  const nowPlayingStyle: React.CSSProperties = useMemo(() => ({
    padding: '10px 14px',
    marginBottom: 12,
    borderRadius: 14,
    backgroundColor: `rgba(255, 255, 255, ${Math.max(cardOpacity * 1.5 + 0.05, 0.15)})`,
    border: `1px solid rgba(255, 255, 255, ${Math.min(borderOpacity * 1.5, 0.4)})`,
    boxShadow: `0 4px 20px rgba(255, 255, 255, ${0.1 * common.backgroundOpacity}), inset 0 1px 0 rgba(255, 255, 255, ${0.2 * common.backgroundOpacity})`,
  }), [cardOpacity, borderOpacity, common.backgroundOpacity]);

  const bodyStyle: React.CSSProperties = useMemo(() => ({
    fontSize: common.scale(16),
    lineHeight: 1.8,
    fontFamily: bodyFont,
  }), [bodyFont, common]);

  return (
    <div style={containerStyle}>
      <LiquidGlassFilter id={LIQUID_FILTER_ID} />
      <div style={frameStyle}>
        <div aria-hidden style={specularStyle} />
        <div style={contentLayerStyle}>
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
            fontFamily={bodyFont}
            baseFontSize={17}
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
                ((rawOptions as Record<string, unknown>)?.donationColor as string) ?? '#fbbf24'
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
