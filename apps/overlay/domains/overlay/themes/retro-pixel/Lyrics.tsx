'use client';

import { type CSSProperties } from 'react';
import { buildFontFamilyValue, useCommonOptions, PlainLyricsBody, useLyricsState, resolveLyricsViewMode } from '../shared';
import type { ThemeWidgetProps } from '../types';

export default function Lyrics({ data, options: rawOptions, fonts }: ThemeWidgetProps) {
  const common = useCommonOptions(rawOptions);
  const viewMode = resolveLyricsViewMode((rawOptions as Record<string, unknown>)?.lyricsViewMode);
  const state = useLyricsState(data, rawOptions);
  if (state.shouldHide) return null;
  const bodyFont = common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['"Press Start 2P"', 'monospace']);
  const textColor = common.textColor ?? '#e0ff66';
  const accent = common.accentColor ?? '#ff5277';
  const cardBg = `rgba(15,15,20, ${0.92 * common.backgroundOpacity})`;
  const cardStyle: CSSProperties = {
    width: '100%', height: '100%', padding: 18,
    background: cardBg,
    border: `4px solid ${accent}`,
    borderRadius: 0,
    boxShadow: `8px 8px 0 ${accent}`,
    fontFamily: bodyFont, color: textColor,
    display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'center', gap: 12,
    overflow: 'hidden',
    imageRendering: 'pixelated',
  };

  if (state.status !== 'ok') {
    return (
      <div style={{ width: '100%', height: '100%' }}>
        <div style={{ ...cardStyle, fontSize: common.scale(13), textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {`> ${state.message ?? ''}`}
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
            <div style={{ fontSize: common.scale(11), opacity: 0.6, textTransform: 'uppercase' }}>
              {'> WAITING...'}
            </div>
          )}
          <div style={{
            fontSize: common.scale(28), fontWeight: 700, color: accent,
            textAlign: 'center', lineHeight: 1.4, letterSpacing: '0.05em', textTransform: 'uppercase',
            textShadow: `2px 2px 0 #000`,
          }}>
            {state.lines[idx]?.text ?? ''}
          </div>
        </div>
      </div>
    );
  }

  const lineFontSize = common.scale(viewMode === 'three-line' ? 16 : 14);
  const isThreeLine = viewMode === 'three-line';
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <div style={cardStyle}>
        {state.isWaiting && (
          <div style={{ fontSize: common.scale(10), opacity: 0.6, textTransform: 'uppercase', textAlign: 'center', letterSpacing: '0.1em' }}>
            {'> 리모컨에서 영상이나 가사를 재생시켜주세요'}
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
          <ul style={{
            listStyle: 'none', margin: 0, padding: isThreeLine ? '50% 0' : 0,
            fontSize: lineFontSize, lineHeight: 2, textAlign: 'center',
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>
            {state.lines.map((line, i) => {
              const isActive = !state.isWaiting && i === state.activeIndex;
              return (
                <li key={i} ref={(el) => { state.lineRefs.current[i] = el; }} style={{
                  color: isActive ? accent : textColor,
                  opacity: isActive ? 1 : 0.4,
                  transition: 'all 100ms steps(2)',
                  margin: '0.3em 0',
                  textShadow: isActive ? `2px 2px 0 #000` : 'none',
                }}>
                  {isActive ? '> ' : '  '}{line.text || ' '}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
