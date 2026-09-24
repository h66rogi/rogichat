'use client';

import { useMemo, type CSSProperties, memo} from 'react';
import type { ThemeWidgetProps } from '../types';
import { buildFontFamilyValue, useCommonOptions } from '../shared';
import { hexToRgba as sharedHexToRgba, buildBlurFilter } from '../shared/apply-transparency';
import {
  type SpotifyLayoutOptions,
  DEFAULT_LAYOUT_OPTIONS,
} from '@/domains/overlay/types/options';
import {
  SetlistHeader,
  SetlistNowPlaying,
  SetlistBody,
  SetlistAutoScroll,
} from '@/domains/overlay/components/setlist';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): SpotifyLayoutOptions {
  return {
    ...DEFAULT_LAYOUT_OPTIONS.spotify,
    ...(raw as Partial<SpotifyLayoutOptions>),
  };
}

function Setlist({ data, options: rawOptions, fonts }: Props) {
  const opts = useMemo(() => resolveOptions(rawOptions), [rawOptions]);
  const common = useCommonOptions(rawOptions);
  const headingFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.heading ?? ['Pretendard', 'sans-serif']),
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

  const accent = common.accentColor ?? opts.progressBarColor ?? '#1DB954';
  const baseBgColor = opts.backgroundColor || '#191414';
  const textColor = common.textColor ?? '#ffffff';
  const mutedColor = 'rgba(255, 255, 255, 0.6)';
  const subBg = 'rgba(255, 255, 255, 0.06)';
  const blurFilter = buildBlurFilter(common.blurIntensity);

  const containerStyle: CSSProperties = useMemo(() => ({
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: 'transparent',
    fontFamily: bodyFont,
    fontWeight: common.fontWeight,
    color: textColor,
  }), [bodyFont, common.textSizeMultiplier, common.fontWeight, textColor]);

  const cardStyle: CSSProperties = useMemo(() => ({
    flex: 1,
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    padding: 18,
    borderRadius: 16,
    backgroundColor: sharedHexToRgba(baseBgColor, common.backgroundOpacity),
    backdropFilter: blurFilter,
    WebkitBackdropFilter: blurFilter,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
  }), [baseBgColor, blurFilter, common.backgroundOpacity]);

  const headerStyle: CSSProperties = useMemo(() => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 14,
    fontFamily: headingFont,
    fontSize: common.scale(12),
    fontWeight: 700,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: mutedColor,
  }), [headingFont, mutedColor, common.textSizeMultiplier]);

  const nowPlayingStyle: CSSProperties = useMemo(() => ({
    padding: '12px 14px',
    marginBottom: 12,
    borderRadius: 10,
    backgroundColor: subBg,
    borderLeft: `3px solid ${accent}`,
    fontFamily: bodyFont,
    color: textColor,
  }), [accent, bodyFont, subBg, textColor]);

  const bodyStyle: CSSProperties = useMemo(() => ({
    fontSize: common.scale(15),
    lineHeight: 1.7,
    color: textColor,
  }), [textColor, common]);

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
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

        {nowPlaying && (
          <div style={nowPlayingStyle}>
            <SetlistNowPlaying
              nowPlaying={nowPlaying}
              textColor={textColor}
              accentColor={accent}
              fontFamily={bodyFont}
              baseFontSize={16}
              textSizeMultiplier={common.textSizeMultiplier}
              showAlbumArt={(rawOptions as Record<string, unknown>)?.showAlbumArt !== false}
            />
          </div>
        )}

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
                ((rawOptions as Record<string, unknown>)?.completedOpacity as number) ?? 0.35
              }
              donationColor={accent}
            />
          </div>
        </SetlistAutoScroll>
      </div>
    </div>
  );
}
Setlist.displayName = 'Setlist';
export default memo(Setlist);
