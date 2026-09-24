'use client';

import { type CSSProperties } from 'react';
import { buildFontFamilyValue, useCommonOptions, PlainLyricsBody, useLyricsState, resolveLyricsViewMode } from '../shared';
import type { ThemeWidgetProps } from '../types';

export default function Lyrics({ data, options: rawOptions, fonts }: ThemeWidgetProps) {
  const common = useCommonOptions(rawOptions);
  const viewMode = resolveLyricsViewMode((rawOptions as Record<string, unknown>)?.lyricsViewMode);
  const state = useLyricsState(data, rawOptions);
  if (state.shouldHide) return null;
  const bodyFont = common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['"Roboto Condensed"', 'sans-serif']);
  const textColor = common.textColor ?? '#ffffff';
  const accent = common.accentColor ?? '#facc15';
  const cardBg = `rgba(220,38,38, ${0.92 * common.backgroundOpacity})`;
  const cardStyle: CSSProperties = {
    width: '100%', height: '100%', padding: '14px 22px',
    background: cardBg,
    borderTop: `4px solid ${accent}`,
    borderBottom: `4px solid ${accent}`,
    fontFamily: bodyFont, color: textColor,
    display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'center', gap: 4, overflow: 'hidden',
  };

  if (state.status !== 'ok') {
    return (
      <div style={{ width: '100%', height: '100%' }}>
        <div style={{ ...cardStyle, fontSize: common.scale(15), textAlign: 'center', alignItems: 'center', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
          ▸ {state.message}
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
        <div style={{ ...cardStyle, alignItems: 'center', justifyContent: 'center' }}>
          {state.isWaiting && (
            <div style={{ fontSize: common.scale(11), color: accent, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.2em' }}>
              ▸ ▸ ▸ 리모컨에서 영상이나 가사를 재생시켜주세요 ◂ ◂ ◂
            </div>
          )}
          <div style={{
            fontSize: common.scale(40), fontWeight: 900,
            color: state.isWaiting ? 'rgba(255,255,255,0.45)' : accent,
            textAlign: 'center', lineHeight: 1.1, padding: '0 16px',
            textTransform: 'uppercase', letterSpacing: '-0.01em',
            transition: 'all 200ms ease',
          }}>
            ▸ {state.lines[idx]?.text ?? ''}
          </div>
        </div>
      </div>
    );
  }

  const lineFontSize = common.scale(viewMode === 'three-line' ? 28 : 22);
  const isThreeLine = viewMode === 'three-line';
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <div style={cardStyle}>
        {state.isWaiting && (
          <div style={{ fontSize: common.scale(10), color: accent, textAlign: 'center', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.2em' }}>
            ▸ ▸ 리모컨에서 영상이나 가사를 재생시켜주세요 ◂ ◂
          </div>
        )}
        <div style={{
          width: '100%',
          height: '100%',
          flex: 1,
          overflow: isThreeLine ? 'hidden' : 'auto',
          maskImage: isThreeLine ? 'linear-gradient(to bottom, transparent 0%, #000 25%, #000 75%, transparent 100%)' : undefined,
          WebkitMaskImage: isThreeLine ? 'linear-gradient(to bottom, transparent 0%, #000 25%, #000 75%, transparent 100%)' : undefined,
        }}>
          <ul style={{ listStyle: 'none', margin: 0, padding: isThreeLine ? '50% 0' : 0, fontSize: lineFontSize, lineHeight: 1.35, textAlign: 'center', textTransform: 'uppercase', letterSpacing: '-0.01em' }}>
            {state.lines.map((line, i) => {
              const isActive = !state.isWaiting && i === state.activeIndex;
              return (
                <li key={i} ref={(el) => { state.lineRefs.current[i] = el; }} style={{
                  color: isActive ? accent : textColor,
                  fontWeight: 900,
                  opacity: isActive ? 1 : 0.45,
                  transform: isActive ? 'scale(1.04)' : 'scale(1)',
                  transition: 'all 180ms cubic-bezier(0.4, 0, 0.2, 1)',
                  margin: '0.3em 0', padding: '0 12px',
                }}>
                  {isActive ? '▸ ' : ''}{line.text || ' '}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
