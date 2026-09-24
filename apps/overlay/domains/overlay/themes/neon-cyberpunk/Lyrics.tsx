'use client';

import { type CSSProperties } from 'react';
import { buildFontFamilyValue, useCommonOptions, PlainLyricsBody, useLyricsState, resolveLyricsViewMode } from '../shared';
import { withOpacity } from '../shared/apply-transparency';
import type { ThemeWidgetProps } from '../types';

export default function Lyrics({ data, options: rawOptions, fonts }: ThemeWidgetProps) {
  const common = useCommonOptions(rawOptions);
  const viewMode = resolveLyricsViewMode((rawOptions as Record<string, unknown>)?.lyricsViewMode);
  const state = useLyricsState(data, rawOptions);
  if (state.shouldHide) return null;
  const bodyFont = common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['"Orbitron"', 'sans-serif']);
  const textColor = common.textColor ?? '#e0f7ff';
  const neonPink = common.accentColor ?? '#ff2cdf';
  const neonCyan = '#00f0ff';
  const cardBg = `rgba(10,5,30, ${0.85 * common.backgroundOpacity})`;
  const cardStyle: CSSProperties = {
    width: '100%', height: '100%', padding: 22, borderRadius: 4,
    background: cardBg,
    border: `1px solid ${neonCyan}`,
    boxShadow: `0 0 24px ${withOpacity(neonPink, 0.5)}, inset 0 0 24px ${withOpacity(neonCyan, 0.15)}`,
    fontFamily: bodyFont, color: textColor,
    display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'center', gap: 10, overflow: 'hidden',
  };

  if (state.status !== 'ok') {
    return (
      <div style={{ width: '100%', height: '100%' }}>
        <div style={{ ...cardStyle, fontSize: common.scale(15), textAlign: 'center', alignItems: 'center', textTransform: 'uppercase', letterSpacing: '0.15em', color: neonCyan, textShadow: `0 0 8px ${neonCyan}` }}>
          [{state.message}]
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
            <div style={{ fontSize: common.scale(11), color: neonCyan, textTransform: 'uppercase', letterSpacing: '0.2em', textShadow: `0 0 6px ${neonCyan}` }}>
              ◆ 리모컨에서 영상이나 가사를 재생시켜주세요 ◆
            </div>
          )}
          <div style={{
            fontSize: common.scale(42), fontWeight: 800,
            color: state.isWaiting ? withOpacity(textColor, 0.4) : neonPink,
            textAlign: 'center', lineHeight: 1.15, padding: '0 16px',
            textTransform: 'uppercase', letterSpacing: '0.05em',
            textShadow: state.isWaiting ? 'none' : `0 0 8px ${neonPink}, 0 0 24px ${neonPink}, 0 0 48px ${withOpacity(neonPink, 0.5)}`,
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
          <div style={{ fontSize: common.scale(10), color: neonCyan, textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.18em', textShadow: `0 0 6px ${neonCyan}` }}>
            ◆ 리모컨에서 영상이나 가사를 재생시켜주세요 ◆
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
          <ul style={{ listStyle: 'none', margin: 0, padding: isThreeLine ? '50% 0' : 0, fontSize: lineFontSize, lineHeight: 1.4, textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {state.lines.map((line, i) => {
              const isActive = !state.isWaiting && i === state.activeIndex;
              return (
                <li key={i} ref={(el) => { state.lineRefs.current[i] = el; }} style={{
                  color: isActive ? neonPink : textColor,
                  fontWeight: isActive ? 800 : 600,
                  opacity: isActive ? 1 : 0.45,
                  transform: isActive ? 'scale(1.04)' : 'scale(1)',
                  transition: 'all 220ms cubic-bezier(0.4, 0, 0.2, 1)',
                  margin: '0.4em 0', padding: '0 14px',
                  textShadow: isActive ? `0 0 8px ${neonPink}, 0 0 16px ${neonPink}` : 'none',
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
