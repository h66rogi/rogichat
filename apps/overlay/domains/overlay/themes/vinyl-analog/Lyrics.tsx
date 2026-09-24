'use client';

import { type CSSProperties } from 'react';
import { buildFontFamilyValue, useCommonOptions, PlainLyricsBody, useLyricsState, resolveLyricsViewMode } from '../shared';
import type { ThemeWidgetProps } from '../types';

export default function Lyrics({ data, options: rawOptions, fonts }: ThemeWidgetProps) {
  const common = useCommonOptions(rawOptions);
  const viewMode = resolveLyricsViewMode((rawOptions as Record<string, unknown>)?.lyricsViewMode);
  const state = useLyricsState(data, rawOptions);
  if (state.shouldHide) return null;
  const bodyFont = common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['"Playfair Display"', 'serif']);
  const textColor = common.textColor ?? '#3a2418';
  const accent = common.accentColor ?? '#b8860b';
  const cardBg = `linear-gradient(135deg, rgba(243,229,201,${0.95 * common.backgroundOpacity}), rgba(218,193,151,${0.95 * common.backgroundOpacity}))`;
  const cardStyle: CSSProperties = {
    width: '100%', height: '100%', padding: 24, borderRadius: 8,
    background: cardBg,
    border: `2px solid ${accent}`,
    boxShadow: `inset 0 0 60px rgba(58,36,24,0.15), 0 4px 12px rgba(0,0,0,0.3)`,
    fontFamily: bodyFont, color: textColor,
    display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'center', gap: 10, overflow: 'hidden',
    backgroundBlendMode: 'multiply',
  };

  if (state.status !== 'ok') {
    return (
      <div style={{ width: '100%', height: '100%' }}>
        <div style={{ ...cardStyle, fontSize: common.scale(17), textAlign: 'center', alignItems: 'center', fontStyle: 'italic' }}>
          ♪ {state.message} ♪
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
            <div style={{ fontSize: common.scale(13), opacity: 0.6, fontStyle: 'italic' }}>(리모컨에서 영상이나 가사를 재생시켜주세요)</div>
          )}
          <div style={{
            fontSize: common.scale(40), fontWeight: 600, color: state.isWaiting ? 'rgba(58,36,24,0.5)' : accent,
            textAlign: 'center', lineHeight: 1.2, padding: '0 16px', fontStyle: 'italic',
            transition: 'all 220ms ease',
          }}>
            {state.lines[idx]?.text ?? ''}
          </div>
        </div>
      </div>
    );
  }

  const lineFontSize = common.scale(viewMode === 'three-line' ? 26 : 22);
  const isThreeLine = viewMode === 'three-line';
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <div style={cardStyle}>
        {state.isWaiting && (
          <div style={{ fontSize: common.scale(13), opacity: 0.6, textAlign: 'center', fontStyle: 'italic' }}>(리모컨에서 영상이나 가사를 재생시켜주세요)</div>
        )}
        <div style={{
          width: '100%',
          height: '100%',
          flex: 1,
          overflow: isThreeLine ? 'hidden' : 'auto',
          maskImage: isThreeLine ? 'linear-gradient(to bottom, transparent 0%, #000 25%, #000 75%, transparent 100%)' : undefined,
          WebkitMaskImage: isThreeLine ? 'linear-gradient(to bottom, transparent 0%, #000 25%, #000 75%, transparent 100%)' : undefined,
        }}>
          <ul style={{ listStyle: 'none', margin: 0, padding: isThreeLine ? '50% 0' : 0, fontSize: lineFontSize, lineHeight: 1.45, textAlign: 'center' }}>
            {state.lines.map((line, i) => {
              const isActive = !state.isWaiting && i === state.activeIndex;
              return (
                <li key={i} ref={(el) => { state.lineRefs.current[i] = el; }} style={{
                  color: isActive ? accent : textColor,
                  fontWeight: isActive ? 700 : 500,
                  fontStyle: 'italic',
                  opacity: isActive ? 1 : 0.5,
                  transform: isActive ? 'scale(1.03)' : 'scale(1)',
                  transition: 'all 280ms cubic-bezier(0.4, 0, 0.2, 1)',
                  margin: '0.4em 0', padding: '0 14px',
                  textShadow: isActive ? '0 1px 2px rgba(58,36,24,0.3)' : 'none',
                }}>
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
