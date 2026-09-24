'use client';

import { type CSSProperties } from 'react';
import { buildFontFamilyValue, useCommonOptions, PlainLyricsBody, useLyricsState, resolveLyricsViewMode } from '../shared';
import type { ThemeWidgetProps } from '../types';

export default function Lyrics({ data, options: rawOptions, fonts }: ThemeWidgetProps) {
  const common = useCommonOptions(rawOptions);
  const viewMode = resolveLyricsViewMode((rawOptions as Record<string, unknown>)?.lyricsViewMode);
  const state = useLyricsState(data, rawOptions);
  if (state.shouldHide) return null;
  const bodyFont = common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['"Comic Sans MS"', 'cursive']);
  const textColor = common.textColor ?? '#7c3a8e';
  const accent = common.accentColor ?? '#ff6fb5';
  const cardBg = `rgba(255,236,247, ${0.95 * common.backgroundOpacity})`;
  const cardStyle: CSSProperties = {
    width: '100%', height: '100%', padding: 22, borderRadius: 36,
    background: cardBg,
    border: `3px dashed ${accent}`,
    boxShadow: `0 6px 0 rgba(255,143,194,0.4), 0 12px 28px rgba(255,143,194,0.3)`,
    fontFamily: bodyFont, color: textColor,
    display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'center', gap: 10, overflow: 'hidden',
  };

  if (state.status !== 'ok') {
    return (
      <div style={{ width: '100%', height: '100%' }}>
        <div style={{ ...cardStyle, fontSize: common.scale(18), textAlign: 'center', alignItems: 'center' }}>
          ♡ {state.message} ♡
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
            <div style={{ fontSize: common.scale(13), opacity: 0.6 }}>♡ (리모컨에서 영상이나 가사를 재생시켜주세요) ♡</div>
          )}
          <div style={{
            fontSize: common.scale(38), fontWeight: 700, color: state.isWaiting ? withAlpha(textColor, 0.4) : accent,
            textAlign: 'center', lineHeight: 1.2, padding: '0 16px', transition: 'all 220ms ease',
          }}>
            ✨ {state.lines[idx]?.text ?? ''} ✨
          </div>
        </div>
      </div>
    );
  }

  const lineFontSize = common.scale(viewMode === 'three-line' ? 24 : 20);
  const isThreeLine = viewMode === 'three-line';
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <div style={cardStyle}>
        {state.isWaiting && (
          <div style={{ fontSize: common.scale(12), opacity: 0.6, textAlign: 'center' }}>♡ (리모컨에서 영상이나 가사를 재생시켜주세요) ♡</div>
        )}
        <div style={{
          width: '100%',
          height: '100%',
          flex: 1,
          overflow: isThreeLine ? 'hidden' : 'auto',
          maskImage: isThreeLine ? 'linear-gradient(to bottom, transparent 0%, #000 25%, #000 75%, transparent 100%)' : undefined,
          WebkitMaskImage: isThreeLine ? 'linear-gradient(to bottom, transparent 0%, #000 25%, #000 75%, transparent 100%)' : undefined,
        }}>
          <ul style={{ listStyle: 'none', margin: 0, padding: isThreeLine ? '50% 0' : 0, fontSize: lineFontSize, lineHeight: 1.5, textAlign: 'center' }}>
            {state.lines.map((line, i) => {
              const isActive = !state.isWaiting && i === state.activeIndex;
              return (
                <li key={i} ref={(el) => { state.lineRefs.current[i] = el; }} style={{
                  color: isActive ? accent : textColor,
                  fontWeight: isActive ? 700 : 500,
                  opacity: isActive ? 1 : 0.5,
                  transform: isActive ? 'scale(1.06)' : 'scale(1)',
                  transition: 'all 240ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                  margin: '0.3em 0', padding: '0 14px',
                }}>
                  {isActive ? '♡ ' : ''}{line.text || ' '}{isActive ? ' ♡' : ''}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

function withAlpha(color: string, a: number): string {
  return color.startsWith('rgb')
    ? color.replace(/rgba?\([^)]+\)/, `rgba(0,0,0,${a})`)
    : `rgba(124,58,142,${a})`;
}
