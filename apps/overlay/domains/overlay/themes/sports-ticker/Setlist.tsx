'use client';

import { memo, useMemo } from 'react';
import type { ThemeWidgetProps } from '../types';
import { buildFontFamilyValue, useCommonOptions } from '../shared';
import { hexToRgba, withOpacity, buildBlurFilter } from '../shared/apply-transparency';
import { defaultOptions, type SportsTickerOptions } from './config';
import {
  SetlistHeader,
  SetlistNowPlaying,
  SetlistBody,
  SetlistAutoScroll,
} from '@/domains/overlay/components/setlist';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): SportsTickerOptions {
  return { ...defaultOptions, ...(raw as Partial<SportsTickerOptions>) };
}

function Setlist({ data, options: rawOptions, fonts }: Props) {
  const options = useMemo(() => resolveOptions(rawOptions), [rawOptions]);
  const common = useCommonOptions(rawOptions);
  const headingFont = useMemo(
    () =>
      common.fontFamily ??
      buildFontFamilyValue(fonts.roles.heading ?? ['Inter', 'sans-serif']),
    [common.fontFamily, fonts.roles.heading],
  );
  const bodyFont = useMemo(
    () =>
      common.fontFamily ??
      buildFontFamilyValue(
        fonts.roles.body ?? ['Roboto Condensed', 'sans-serif'],
      ),
    [common.fontFamily, fonts.roles.body],
  );

  const setlistData = useMemo(() => data?.setlist ?? [], [data?.setlist]);
  const nowPlaying = useMemo(
    () => setlistData.find((s) => s.status === 'PLAYING') ?? data?.nowPlaying,
    [setlistData, data?.nowPlaying],
  );
  const settings = data?.settings;

  const brandColor = options.brandColor || common.accentColor || "#c0392b";
  const accentColor = options.accentColor;
  const textColor = common.textColor ?? options.textColor;
  const bgColor = options.backgroundColor;

  const containerStyle: React.CSSProperties = useMemo(
    () => ({
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: hexToRgba(bgColor, common.backgroundOpacity),
      border: `2px solid ${withOpacity(brandColor, common.borderOpacity)}`,
      fontFamily: bodyFont,
      fontWeight: common.fontWeight,
      color: textColor,
      overflow: 'hidden',
      backdropFilter: buildBlurFilter(common.blurIntensity),
      WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
    }),
    [
      bgColor,
      bodyFont,
      brandColor,
      common.backgroundOpacity,
      common.blurIntensity,
      common.borderOpacity,
      common.fontWeight,
      textColor,
    ],
  );

  return (
    <div style={containerStyle}>
      {/* Header bar — broadcast top strip */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 16px',
          background: brandColor,
          color: textColor,
          flexShrink: 0,
          fontFamily: headingFont,
          fontSize: common.scale(12),
          fontWeight: 900,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
        }}
      >
        <SetlistHeader
          requestEnabled={settings?.requestEnabled ?? false}
          paused={settings?.paused ?? false}
          donationEnabled={settings?.donationPriorityEnabled ?? false}
          setlist={setlistData}
          showRequestMethods={(rawOptions as Record<string, unknown>)?.showRequestMethods !== false}
        />
      </div>

      {/* NowPlaying — accent strip below header */}
      <div
        style={{
          padding: '12px 16px',
          background: hexToRgba(brandColor, 0.18),
          borderBottom: `2px solid ${withOpacity(brandColor, common.borderOpacity)}`,
        }}
      >
        <SetlistNowPlaying
          nowPlaying={nowPlaying}
          textColor={textColor}
          accentColor={brandColor}
          fontFamily={headingFont}
          baseFontSize={16}
          textSizeMultiplier={common.textSizeMultiplier}
          showAlbumArt={
            (rawOptions as Record<string, unknown>)?.showAlbumArt !== false
          }
        />
      </div>

      {/* Body — setlist flow */}
      <SetlistAutoScroll
        threshold={
          ((rawOptions as Record<string, unknown>)?.autoScrollThreshold as
            | number
            | undefined) ?? 600
        }
      >
        <div
          style={{
            padding: '14px 18px',
            fontFamily: bodyFont,
            fontSize: common.scale(15),
            fontWeight: 800,
            lineHeight: 1.7,
            letterSpacing: '0.05em',
            color: textColor,
            textTransform: 'uppercase',
          }}
        >
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
                | undefined) ?? 0.3
            }
            donationColor={
              ((rawOptions as Record<string, unknown>)?.donationColor as
                | string
                | undefined) ?? brandColor
            }
          />
        </div>
      </SetlistAutoScroll>

      {/* Footer bar */}
      <div
        style={{
          marginTop: 'auto',
          padding: '6px 16px',
          background: brandColor,
          color: textColor,
          fontFamily: headingFont,
          fontWeight: 900,
          fontSize: common.scale(10),
          letterSpacing: '0.4em',
          textTransform: 'uppercase',
          textAlign: 'center',
          flexShrink: 0,
        }}
      >
        MELOMING.COM · ON AIR
      </div>
    </div>
  );
}

Setlist.displayName = 'Setlist';
export default memo(Setlist);
