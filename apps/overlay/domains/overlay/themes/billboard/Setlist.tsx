'use client';

import { useMemo, type CSSProperties, memo} from 'react';
import type { ThemeWidgetProps } from '../types';
import {
  buildFontFamilyValue,
  useCommonOptions,
  useContainerUnitsSupport,
  cqwCap,
  fluidOr,
  resolveTextStroke,
  withTextStroke,
  buildTextStrokeStyle,
} from '../shared';
import { buildBlurFilter } from '../shared/apply-transparency';
import {
  type BillboardLayoutOptions,
  DEFAULT_LAYOUT_OPTIONS,
} from '@/domains/overlay/types/options';
import {
  SetlistHeader,
  SetlistNowPlaying,
  SetlistBody,
  SetlistAutoScroll,
} from '@/domains/overlay/components/setlist';

type Props = ThemeWidgetProps;

// Billboard-specific extension: gray backdrop color for the "NOW PLAYING"
// row in the setlist view. Driven by `options.setlistNowPlayingBg`.
interface BillboardSetlistExtraOptions {
  setlistNowPlayingBg?: string;
}

const DEFAULT_SETLIST_NOW_PLAYING_BG = '#3A3A3A';

function resolveOptions(raw: Record<string, unknown>): BillboardLayoutOptions {
  return {
    ...DEFAULT_LAYOUT_OPTIONS.billboard,
    ...(raw as Partial<BillboardLayoutOptions>),
  };
}

const ALIGN_TO_FLEX = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
} as const;

function Setlist({ data, options: rawOptions, fonts }: Props) {
  const opts = useMemo(() => resolveOptions(rawOptions), [rawOptions]);
  const common = useCommonOptions(rawOptions);
  const supportsCq = useContainerUnitsSupport();
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

  // titleSize stays raw (unscaled) because it's fed into <SetlistNowPlaying>
  // as `baseFontSize`, and that component multiplies by `textSizeMultiplier`
  // internally. Pre-scaling here would double-apply the multiplier (m²).
  const titleSize = Math.max(16, opts.titleFontSize / 2);
  const headerSize = common.scale(Math.max(13, Math.round((opts.titleFontSize / 2) * 0.45)));
  const bodySize = common.scale(Math.max(16, Math.round((opts.titleFontSize / 2) * 0.6)));
  // The cqw overflow ceiling must scale with the same `textSize` multiplier as
  // the px sizes above. A *fixed* cqw cap silently swallows the multiplier: once
  // the scaled px passes the constant ceiling, header/body freeze at 3cqw/4.5cqw
  // while the (uncapped) NOW PLAYING block keeps growing, so the font-size
  // control appears to do nothing on the list. Scaling the ceiling by the
  // multiplier keeps `textSize` uniform across the whole setlist and still
  // shrinks responsively on narrow widgets — min(scaledPx, scaledCqw) factors to
  // multiplier × min(basePx, baseCqw). At textSize=1.0 it is identical to before.
  const headerCapCqw = 3 * common.textSizeMultiplier;
  const bodyCapCqw = 4.5 * common.textSizeMultiplier;
  const stroke = useMemo(
    () => resolveTextStroke(rawOptions as Record<string, unknown> | undefined),
    [rawOptions],
  );
  const textShadow = withTextStroke(
    stroke,
    opts.transparentBackground
      ? '2px 2px 8px rgba(0, 0, 0, 0.5), 0 0 30px rgba(0, 0, 0, 0.3)'
      : undefined,
  );
  const flexAlign = ALIGN_TO_FLEX[opts.textAlign];
  const textColor = common.textColor ?? opts.textColor;
  const accentColor = common.accentColor ?? opts.textColor;
  const fontWeight = common.fontWeight ?? Number(opts.fontWeight);
  const setlistNowPlayingBg =
    (rawOptions as BillboardSetlistExtraOptions)?.setlistNowPlayingBg
      ?? DEFAULT_SETLIST_NOW_PLAYING_BG;

  const blurFilter = buildBlurFilter(common.blurIntensity);
  const strokeStyle = useMemo(() => buildTextStrokeStyle(stroke), [stroke]);

  const containerStyle: CSSProperties = useMemo(() => ({
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: flexAlign,
    justifyContent: 'flex-start',
    containerType: supportsCq ? 'inline-size' : undefined,
    padding: fluidOr('24px', 'min(24px, 4cqw)', supportsCq),
    background: opts.transparentBackground
      ? 'transparent'
      : `rgba(0, 0, 0, ${0.5 * common.backgroundOpacity})`,
    backdropFilter: blurFilter,
    WebkitBackdropFilter: blurFilter,
    fontFamily: bodyFont,
    color: textColor,
    textAlign: opts.textAlign,
    textShadow,
    ...strokeStyle,
  }), [blurFilter, bodyFont, common.backgroundOpacity, flexAlign, opts.textAlign, opts.transparentBackground, supportsCq, textColor, textShadow, strokeStyle]);

  const headerStyle: CSSProperties = useMemo(() => ({
    display: 'flex',
    flexDirection: opts.textAlign === 'right' ? 'row-reverse' : 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    width: '100%',
    gap: 12,
    marginBottom: 16,
    fontFamily: headingFont,
    fontSize: cqwCap(headerSize, headerCapCqw, supportsCq),
    fontWeight,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    opacity: 0.7,
    color: textColor,
    textShadow,
  }), [headerSize, headerCapCqw, headingFont, opts.textAlign, fontWeight, supportsCq, textColor, textShadow]);

  const nowPlayingBlockStyle: CSSProperties = useMemo(() => ({
    display: 'flex',
    flexDirection: 'column',
    alignItems: flexAlign,
    width: '100%',
    marginBottom: 18,
    padding: fluidOr('14px 16px', 'min(14px, 2.5cqw) min(16px, 3cqw)', supportsCq),
    borderRadius: 10,
    backgroundColor: setlistNowPlayingBg,
    color: textColor,
    fontFamily: bodyFont,
    textShadow,
  }), [bodyFont, flexAlign, setlistNowPlayingBg, supportsCq, textColor, textShadow]);

  const bodyStyle: CSSProperties = useMemo(() => ({
    width: '100%',
    fontSize: cqwCap(bodySize, bodyCapCqw, supportsCq),
    fontWeight,
    lineHeight: 1.5,
    color: textColor,
    textShadow,
  }), [bodySize, bodyCapCqw, fontWeight, supportsCq, textColor, textShadow]);

  return (
    <div style={containerStyle}>
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
        <div style={nowPlayingBlockStyle}>
          <SetlistNowPlaying
            nowPlaying={nowPlaying}
            textColor={textColor}
            accentColor={accentColor}
            fontFamily={bodyFont}
            baseFontSize={titleSize}
            textSizeMultiplier={common.textSizeMultiplier}
            showAlbumArt={(rawOptions as Record<string, unknown>)?.showAlbumArt !== false}
          />
        </div>
      )}

      <SetlistAutoScroll
        threshold={
          ((rawOptions as Record<string, unknown>)?.autoScrollThreshold as number) ?? 600
        }
        className="setlist-billboard-scroll"
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
            donationColor={
              ((rawOptions as Record<string, unknown>)?.donationColor as string) ?? '#fbbf24'
            }
          />
        </div>
      </SetlistAutoScroll>
    </div>
  );
}
Setlist.displayName = 'Setlist';
export default memo(Setlist);
