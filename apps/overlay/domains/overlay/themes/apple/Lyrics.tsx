'use client';

import { type CSSProperties } from 'react';
import { buildFontFamilyValue, useCommonOptions, PlainLyricsBody, useLyricsState, resolveLyricsViewMode } from '../shared';
import { withOpacity, buildBlurFilter } from '../shared/apply-transparency';
import type { ThemeWidgetProps } from '../types';

export default function Lyrics({ data, options: rawOptions, fonts }: ThemeWidgetProps) {
  const common = useCommonOptions(rawOptions);
  const viewMode = resolveLyricsViewMode((rawOptions as Record<string, unknown>)?.lyricsViewMode);
  const state = useLyricsState(data, rawOptions);
  if (state.shouldHide) return null;

  const isDark = (rawOptions as { theme?: string })?.theme !== 'light';
  const bodyFont = common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['Pretendard', 'sans-serif']);
  const textColor = common.textColor ?? (isDark ? '#ffffff' : '#1d1d1f');
  const accent = common.accentColor ?? '#FA243C';
  const baseAlpha = isDark ? 0.78 : 0.92;
  const cardBg = isDark
    ? `rgba(0,0,0, ${baseAlpha * common.backgroundOpacity})`
    : `rgba(255,255,255, ${baseAlpha * common.backgroundOpacity})`;
  const subtitleColor = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)';
  const subBorder = withOpacity(
    isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    common.borderOpacity,
  );
  const filter = buildBlurFilter(common.blurIntensity, 'saturate(180%)');
  const cardStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    padding: 22,
    borderRadius: 24,
    background: cardBg,
    border: `1px solid ${subBorder}`,
    backdropFilter: filter,
    WebkitBackdropFilter: filter,
    boxShadow: isDark
      ? '0 8px 32px rgba(0,0,0,0.5)'
      : '0 8px 32px rgba(0,0,0,0.12)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    fontFamily: bodyFont,
    color: textColor,
    overflow: 'hidden',
    letterSpacing: '-0.01em',
  };

  if (state.status !== 'ok') {
    return (
      <div style={{ width: '100%', height: '100%' }}>
        <div style={{ ...cardStyle, fontSize: common.scale(16), color: subtitleColor, textAlign: 'center' }}>
          {state.message}
        </div>
      </div>
    );
  }

  if (!state.hasSynced || !state.lines) {
    return (
      <PlainLyricsBody body={state.lyrics?.body ?? ''} fontSize={common.scale(20)} color={textColor} fontFamily={bodyFont} fontWeight={common.fontWeight} cardStyle={cardStyle} />
    );
  }

  if (viewMode === 'karaoke') {
    const idx = state.activeIndex < 0 ? 0 : state.activeIndex;
    return (
      <div style={{ width: '100%', height: '100%' }}>
        <div style={cardStyle}>
          {state.isWaiting && (
            <div style={{ fontSize: common.scale(13), color: subtitleColor }}>
              (리모컨에서 영상이나 가사를 재생시켜주세요)
            </div>
          )}
          <div
            style={{
              fontSize: common.scale(40),
              fontWeight: 600,
              color: state.isWaiting ? subtitleColor : accent,
              textAlign: 'center',
              lineHeight: 1.15,
              padding: '0 16px',
              transition: 'color 200ms ease',
            }}
          >
            {state.lines[idx]?.text ?? ''}
          </div>
        </div>
      </div>
    );
  }

  const lineFontSize = common.scale(viewMode === 'three-line' ? 26 : 24);
  const isThreeLine = viewMode === 'three-line';
  const fadeMask =
    'linear-gradient(to bottom, transparent 0%, #000 22%, #000 78%, transparent 100%)';

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <div style={{ ...cardStyle, alignItems: 'stretch' }}>
        {state.isWaiting && (
          <div style={{ fontSize: common.scale(13), color: subtitleColor, textAlign: 'center' }}>
            (리모컨에서 영상이나 가사를 재생시켜주세요)
          </div>
        )}
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            flex: 1,
            overflow: isThreeLine ? 'hidden' : 'auto',
            maskImage: isThreeLine ? fadeMask : undefined,
            WebkitMaskImage: isThreeLine ? fadeMask : undefined,
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
              fontWeight: common.fontWeight,
            }}
          >
            {state.lines.map((line, i) => {
              const isActive = !state.isWaiting && i === state.activeIndex;
              return (
                <li
                  key={i}
                  ref={(el) => { state.lineRefs.current[i] = el; }}
                  style={{
                    color: isActive ? accent : textColor,
                    fontWeight: isActive ? 600 : common.fontWeight,
                    opacity: isActive ? 1 : 0.45,
                    transform: isActive ? 'scale(1.02)' : 'scale(1)',
                    transition: 'all 220ms cubic-bezier(0.4, 0, 0.2, 1)',
                    margin: '0.4em 0',
                    padding: '0 14px',
                    letterSpacing: '-0.01em',
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
  );
}
