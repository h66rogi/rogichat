'use client';

import { memo, useMemo, type CSSProperties } from 'react';
import {
  buildFontFamilyValue,
  useCommonOptions,
  useLyricsState,
  resolveLyricsViewMode,
} from '../shared';
import { withOpacity } from '../shared/apply-transparency';
import type { ThemeWidgetProps } from '../types';
import { defaultOptions, type GlassmorphismOptions } from './config';
import LiquidGlassFilter from './LiquidGlassFilter';

const LIQUID_FILTER_ID = 'liquid-glass-lyrics';

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

function Lyrics({ data, options: rawOptions, fonts, reducedMotion }: ThemeWidgetProps) {
  const options = useMemo(() => resolveOptions(rawOptions), [rawOptions]);
  const common = useCommonOptions(rawOptions);
  const viewMode = resolveLyricsViewMode((rawOptions as Record<string, unknown>)?.lyricsViewMode);
  const state = useLyricsState(data, rawOptions);

  const headingFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.heading ?? ['Inter', 'sans-serif']),
    [common.fontFamily, fonts.roles.heading],
  );
  const bodyFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['Pretendard', 'sans-serif']),
    [common.fontFamily, fonts.roles.body],
  );
  const accentFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.accent ?? ['Inter', 'monospace']),
    [common.fontFamily, fonts.roles.accent],
  );

  const textColor = common.textColor ?? options.textColor ?? '#ffffff';
  const accentColor = common.accentColor ?? '#7dd3fc';

  // iOS-26 Liquid Glass knobs (0.1–0.6 opacity, 8–40px blur).
  const glassOpacity = clamp(options.glassOpacity ?? defaultOptions.glassOpacity, 0.1, 0.6);
  const glassBlur = clamp(options.glassBlur ?? defaultOptions.glassBlur, 8, 40);
  const blurPx = common.blurIntensity;
  const borderOpacity = common.borderOpacity;

  const containerStyle: CSSProperties = useMemo(() => ({
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
  }), [bodyFont, common.fontWeight, textColor]);

  const frameStyle: CSSProperties = useMemo(() => {
    const effectiveGlassOpacity = glassOpacity * common.backgroundOpacity;
    const liquidFilter = `url(#${LIQUID_FILTER_ID}) blur(${glassBlur}px) saturate(180%)`;
    const fallbackFilter = `blur(${blurPx}px) saturate(180%)`;
    return {
      position: 'relative',
      flex: 1,
      width: '100%',
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
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    };
  }, [glassBlur, glassOpacity, blurPx, borderOpacity, common.backgroundOpacity]);

  const specularStyle: CSSProperties = useMemo(() => ({
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

  const baseContentLayer: CSSProperties = useMemo(() => ({
    position: 'relative',
    zIndex: 1,
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  }), []);

  if (state.shouldHide) return null;

  // === Status (loading / error / waiting / restricted / ...) ===
  if (state.status !== 'ok') {
    return (
      <div style={containerStyle}>
        <LiquidGlassFilter id={LIQUID_FILTER_ID} />
        <div style={frameStyle}>
          <div aria-hidden style={specularStyle} />
          <div
            style={{
              ...baseContentLayer,
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              fontSize: common.scale(16),
              fontFamily: bodyFont,
              opacity: 0.85,
            }}
          >
            {state.message}
          </div>
        </div>
      </div>
    );
  }

  // === Plain body fallback (synced lyrics 없음) ===
  if (!state.hasSynced || !state.lines) {
    return (
      <div style={containerStyle}>
        <LiquidGlassFilter id={LIQUID_FILTER_ID} />
        <div style={frameStyle}>
          <div aria-hidden style={specularStyle} />
          <div
            style={{
              ...baseContentLayer,
              overflow: 'auto',
              alignItems: 'stretch',
              justifyContent: 'flex-start',
            }}
          >
            <pre
              style={{
                margin: 0,
                padding: '4px 6px',
                fontSize: common.scale(20),
                color: textColor,
                fontFamily: bodyFont,
                fontWeight: common.fontWeight,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                textAlign: 'center',
              }}
            >
              {state.lyrics?.body ?? ''}
            </pre>
          </div>
        </div>
      </div>
    );
  }

  // === Karaoke single-line ===
  if (viewMode === 'karaoke') {
    const idx = state.activeIndex < 0 ? 0 : state.activeIndex;
    return (
      <div style={containerStyle}>
        <LiquidGlassFilter id={LIQUID_FILTER_ID} />
        <div style={frameStyle}>
          <div aria-hidden style={specularStyle} />
          <div
            style={{
              ...baseContentLayer,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
            }}
          >
            {state.isWaiting && (
              <div
                style={{
                  fontSize: common.scale(13),
                  fontFamily: accentFont,
                  opacity: 0.6,
                  textAlign: 'center',
                }}
              >
                (리모컨에서 영상이나 가사를 재생시켜주세요)
              </div>
            )}
            <div
              style={{
                fontSize: common.scale(40),
                fontWeight: 600,
                fontFamily: headingFont,
                color: state.isWaiting ? withOpacity(textColor, 0.5) : accentColor,
                textAlign: 'center',
                lineHeight: 1.2,
                padding: '0 16px',
                transition: reducedMotion
                  ? 'none'
                  : 'color 220ms ease, text-shadow 220ms ease',
                textShadow: state.isWaiting ? 'none' : `0 0 24px ${withOpacity(accentColor, 0.5)}`,
              }}
            >
              {state.lines[idx]?.text ?? ''}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // === Scroll / three-line ===
  const isThreeLine = viewMode === 'three-line';
  const lineFontSize = common.scale(isThreeLine ? 26 : 22);

  return (
    <div style={containerStyle}>
      <LiquidGlassFilter id={LIQUID_FILTER_ID} />
      <div style={frameStyle}>
        <div aria-hidden style={specularStyle} />
        <div
          style={{
            ...baseContentLayer,
            alignItems: 'stretch',
            justifyContent: 'flex-start',
            gap: 12,
          }}
        >
          {state.isWaiting && (
            <div
              style={{
                fontSize: common.scale(13),
                fontFamily: accentFont,
                opacity: 0.6,
                textAlign: 'center',
              }}
            >
              (리모컨에서 영상이나 가사를 재생시켜주세요)
            </div>
          )}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflow: isThreeLine ? 'hidden' : 'auto',
              maskImage: isThreeLine
                ? 'linear-gradient(to bottom, transparent 0%, #000 25%, #000 75%, transparent 100%)'
                : undefined,
              WebkitMaskImage: isThreeLine
                ? 'linear-gradient(to bottom, transparent 0%, #000 25%, #000 75%, transparent 100%)'
                : undefined,
            }}
          >
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: isThreeLine ? '50% 0' : 0,
                fontSize: lineFontSize,
                lineHeight: 1.4,
                textAlign: 'center',
                fontFamily: bodyFont,
              }}
            >
              {state.lines.map((line, i) => {
                const isActive = !state.isWaiting && i === state.activeIndex;
                return (
                  <li
                    key={i}
                    ref={(el) => { state.lineRefs.current[i] = el; }}
                    style={{
                      color: isActive ? accentColor : textColor,
                      fontWeight: isActive ? 600 : common.fontWeight,
                      opacity: isActive ? 1 : 0.4,
                      transform: isActive ? 'scale(1.03)' : 'scale(1)',
                      transition: reducedMotion
                        ? 'none'
                        : 'color 240ms cubic-bezier(0.4, 0, 0.2, 1), opacity 240ms cubic-bezier(0.4, 0, 0.2, 1), transform 240ms cubic-bezier(0.4, 0, 0.2, 1), text-shadow 240ms cubic-bezier(0.4, 0, 0.2, 1)',
                      margin: '0.4em 0',
                      padding: '0 14px',
                      textShadow: isActive ? `0 0 20px ${withOpacity(accentColor, 0.4)}` : 'none',
                    }}
                  >
                    {line.text || ' '}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

Lyrics.displayName = 'Lyrics';
export default memo(Lyrics);
