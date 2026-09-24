'use client';

import { memo, useMemo } from 'react';
import type { ThemeWidgetProps } from '../types';
import { buildFontFamilyValue, useCommonOptions } from '../shared';
import { hexToRgba, withOpacity, buildBlurFilter } from '../shared/apply-transparency';
import { defaultOptions, type ConcertPosterOptions } from './config';
import {
  SetlistHeader,
  SetlistNowPlaying,
  SetlistBody,
  SetlistAutoScroll,
} from '@/domains/overlay/components/setlist';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): ConcertPosterOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<ConcertPosterOptions>),
  };
}

function buildSoftShadow(offset: number, color: string): string {
  // Single soft drop shadow only — no hard box silhouette behind text.
  const o = Math.max(1, Math.round(offset));
  return `0 ${o}px ${o * 3 + 2}px ${color}88`;
}

function Setlist({ data, options: rawOptions, fonts }: Props) {
  const options = useMemo(() => resolveOptions(rawOptions), [rawOptions]);
  const common = useCommonOptions(rawOptions);
  const headingFont = useMemo(
    () =>
      common.fontFamily ??
      buildFontFamilyValue(fonts.roles.heading ?? ['IBM Plex Sans', 'sans-serif']),
    [common.fontFamily, fonts.roles.heading],
  );
  const bodyFont = useMemo(
    () =>
      common.fontFamily ??
      buildFontFamilyValue(fonts.roles.body ?? ['IBM Plex Sans', 'sans-serif']),
    [common.fontFamily, fonts.roles.body],
  );

  const setlistData = useMemo(() => data?.setlist ?? [], [data?.setlist]);
  const nowPlaying = useMemo(
    () => setlistData.find((s) => s.status === 'PLAYING') ?? data?.nowPlaying,
    [setlistData, data?.nowPlaying],
  );
  const settings = data?.settings;

  const accent = common.accentColor ?? options.accentColor;
  const titleColor = common.textColor ?? options.titleColor;
  const textColor = options.textColor;
  const shadow = buildSoftShadow(options.shadowOffset, options.shadowColor);

  const containerStyle: React.CSSProperties = useMemo(
    () => ({
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      padding: 18,
      fontFamily: bodyFont,
      fontWeight: common.fontWeight,
      color: titleColor,
      background: 'transparent',
      pointerEvents: 'none',
    }),
    [bodyFont, common.fontWeight, titleColor],
  );

  const frameStyle: React.CSSProperties = useMemo(
    () => ({
      flex: 1,
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      // Frame has no fill — keeps the overlay transparent over OBS scenes.
      // The accent left border is the only structural element so the
      // setlist sits on top of stream content without a phantom dark box.
      backgroundColor: 'transparent',
      backdropFilter: buildBlurFilter(common.blurIntensity),
      WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
      borderLeft: `4px solid ${withOpacity(accent, common.borderOpacity)}`,
      padding: 20,
      position: 'relative',
    }),
    [accent, common.borderOpacity, common.blurIntensity],
  );

  const headerStyle: React.CSSProperties = useMemo(
    () => ({
      display: 'flex',
      alignItems: 'baseline',
      gap: 12,
      paddingBottom: 12,
      borderBottom: `1px solid ${withOpacity(accent, 0.27 * common.borderOpacity)}`,
      fontFamily: headingFont,
      fontSize: common.scale(13),
      fontWeight: 700,
      letterSpacing: '0.18em',
      textTransform: 'uppercase',
      color: accent,
    }),
    [accent, headingFont, common.borderOpacity, common.scale],
  );

  const nowPlayingStyle: React.CSSProperties = useMemo(
    () => ({
      paddingTop: 14,
      paddingBottom: 14,
      borderBottom: `1px solid ${withOpacity(accent, 0.27 * common.borderOpacity)}`,
    }),
    [accent, common.borderOpacity],
  );

  const bodyStyle: React.CSSProperties = useMemo(
    () => ({
      fontSize: common.scale(18),
      fontWeight: 700,
      lineHeight: 1.7,
      letterSpacing: '0.005em',
      color: titleColor,
      textShadow: shadow,
      fontFamily: bodyFont,
      textAlign: 'center',
    }),
    [bodyFont, common.scale, titleColor, shadow],
  );

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
              (rawOptions as Record<string, unknown>)?.rotationInterval as
                | number
                | undefined
            }
          />
        </div>

        <div style={nowPlayingStyle}>
          <SetlistNowPlaying
            nowPlaying={nowPlaying}
            textColor={titleColor}
            accentColor={accent}
            fontFamily={headingFont}
            baseFontSize={18}
            textSizeMultiplier={common.textSizeMultiplier}
            showAlbumArt={
              (rawOptions as Record<string, unknown>)?.showAlbumArt !== false
            }
          />
        </div>

        <SetlistAutoScroll
          threshold={
            ((rawOptions as Record<string, unknown>)?.autoScrollThreshold as
              | number
              | undefined) ?? 600
          }
        >
          <div style={bodyStyle}>
            <SetlistBody
              setlist={setlistData}
              separator={
                ((rawOptions as Record<string, unknown>)?.separator as
                  | string
                  | undefined) ?? ' / '
              }
              completedOpacity={
                ((rawOptions as Record<string, unknown>)?.completedOpacity as
                  | number
                  | undefined) ?? 0.32
              }
              donationColor={
                ((rawOptions as Record<string, unknown>)?.donationColor as
                  | string
                  | undefined) ?? accent
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
