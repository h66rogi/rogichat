'use client';

import { useMemo, type CSSProperties, memo} from 'react';
import type { ThemeWidgetProps } from '../types';
import { buildFontFamilyValue, useCommonOptions } from '../shared';
import { withOpacity, buildBlurFilter } from '../shared/apply-transparency';
import {
  type AppleLayoutOptions,
  DEFAULT_LAYOUT_OPTIONS,
} from '@/domains/overlay/types/options';
import {
  SetlistHeader,
  SetlistNowPlaying,
  SetlistBody,
  SetlistAutoScroll,
} from '@/domains/overlay/components/setlist';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): AppleLayoutOptions {
  return {
    ...DEFAULT_LAYOUT_OPTIONS.apple,
    ...(raw as Partial<AppleLayoutOptions>),
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

  const isDark = opts.theme === 'dark';
  const accent = common.accentColor ?? opts.accentColor ?? '#FA243C';

  const baseAlpha = isDark ? 0.75 : 0.85;
  const cardBg = isDark
    ? `rgba(0, 0, 0, ${baseAlpha * common.backgroundOpacity})`
    : `rgba(255, 255, 255, ${baseAlpha * common.backgroundOpacity})`;
  const textColor = common.textColor ?? (isDark ? '#ffffff' : '#1d1d1f');
  const mutedColor = isDark ? 'rgba(255, 255, 255, 0.6)' : 'rgba(0, 0, 0, 0.5)';
  const subBg = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)';
  const subBorder = withOpacity(
    isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.08)',
    common.borderOpacity,
  );

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

  const cardStyle: CSSProperties = useMemo(() => {
    const filter = buildBlurFilter(common.blurIntensity, 'saturate(160%)');
    return {
      flex: 1,
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      padding: 18,
      borderRadius: 24,
      backgroundColor: cardBg,
      backdropFilter: filter,
      WebkitBackdropFilter: filter,
      boxShadow: isDark
        ? '0 8px 32px rgba(0, 0, 0, 0.5)'
        : '0 8px 32px rgba(0, 0, 0, 0.15)',
    };
  }, [cardBg, common.blurIntensity, isDark]);

  const headerStyle: CSSProperties = useMemo(() => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 14,
    fontFamily: headingFont,
    fontSize: common.scale(13),
    fontWeight: 600,
    letterSpacing: 0.3,
    color: mutedColor,
  }), [headingFont, mutedColor, common.textSizeMultiplier]);

  const nowPlayingStyle: CSSProperties = useMemo(() => ({
    padding: '12px 14px',
    marginBottom: 12,
    borderRadius: 14,
    backgroundColor: subBg,
    border: subBorder !== 'transparent' ? `1px solid ${subBorder}` : undefined,
    fontFamily: bodyFont,
    color: textColor,
  }), [bodyFont, subBg, subBorder, textColor]);

  const bodyStyle: CSSProperties = useMemo(() => ({
    fontSize: common.scale(15),
    lineHeight: 1.7,
    color: textColor,
  }), [common, textColor]);

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
