'use client';

import { useMemo, memo} from 'react';
import type { ThemeWidgetProps } from '../types';
import { buildFontFamilyValue, useCommonOptions } from '../shared';
import { hexToRgba, withOpacity, buildBlurFilter } from '../shared/apply-transparency';
import { defaultOptions, type BrutalistOptions } from './config';
import {
  SetlistHeader,
  SetlistNowPlaying,
  SetlistBody,
  SetlistAutoScroll,
} from '@/domains/overlay/components/setlist';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): BrutalistOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<BrutalistOptions>),
  };
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function Setlist({
  data,
  options: rawOptions,
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

  const setlistData = useMemo(() => data?.setlist ?? [], [data?.setlist]);
  const nowPlaying = useMemo(
    () => setlistData.find((s) => s.status === 'PLAYING') ?? data?.nowPlaying,
    [setlistData, data?.nowPlaying],
  );
  const settings = data?.settings;

  const borderWidth = clampNumber(options.borderWidth, 2, 8, 5);
  const shadowOffset = clampNumber(options.shadowOffset, 4, 16, 10);
  const tiltAngle = clampNumber(options.tiltAngle, -5, 5, -1);
  const accentColor = common.accentColor ?? options.accentColor ?? '#ffff00';
  const bgColor = options.backgroundColor || '#f5f5dc';
  const ink = common.textColor ?? '#000000';

  const hardShadow = `${shadowOffset}px ${shadowOffset}px 0 #000`;

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
    backgroundColor: hexToRgba(bgColor, common.backgroundOpacity),
    border: `${borderWidth}px solid ${withOpacity(ink, common.borderOpacity)}`,
    borderRadius: 0,
    padding: 16,
    transform: tiltAngle === 0 ? undefined : `rotate(${tiltAngle}deg)`,
    transformOrigin: 'center center',
    backdropFilter: buildBlurFilter(common.blurIntensity),
    WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
  }), [bgColor, borderWidth, ink, tiltAngle, common.backgroundOpacity, common.borderOpacity, common.blurIntensity]);

  const headerStyle: React.CSSProperties = useMemo(() => ({
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 12,
    marginBottom: 14,
    borderBottom: `${borderWidth}px solid ${ink}`,
    fontFamily: headingFont,
    fontWeight: 900,
    fontSize: common.scale(20),
    letterSpacing: -0.5,
    textTransform: 'uppercase',
  }), [borderWidth, headingFont, ink, common.textSizeMultiplier]);

  const nowPlayingStyle: React.CSSProperties = useMemo(() => ({
    padding: 12,
    marginBottom: 14,
    backgroundColor: accentColor,
    border: `${borderWidth}px solid ${ink}`,
    boxShadow: `${Math.max(4, shadowOffset - 4)}px ${Math.max(4, shadowOffset - 4)}px 0 #000`,
    transform: reducedMotion ? undefined : 'rotate(-1.5deg)',
    fontFamily: headingFont,
    fontWeight: 900,
    fontSize: common.scale(16),
    textTransform: 'uppercase',
    letterSpacing: -0.3,
  }), [accentColor, borderWidth, headingFont, ink, reducedMotion, shadowOffset, common.textSizeMultiplier]);

  const bodyStyle: React.CSSProperties = useMemo(() => ({
    fontSize: common.scale(15),
    lineHeight: 1.8,
    fontFamily: bodyFont,
    fontWeight: 700,
    color: ink,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  }), [bodyFont, ink, common]);

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
            textColor={ink}
            accentColor={ink}
            fontFamily={headingFont}
            baseFontSize={15}
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
                ((rawOptions as Record<string, unknown>)?.donationColor as string) ?? '#ffff00'
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
