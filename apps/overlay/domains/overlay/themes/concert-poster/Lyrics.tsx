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
  const headingFont = common.fontFamily ?? buildFontFamilyValue(fonts.roles.heading ?? ['"Bebas Neue"', 'sans-serif']);
  const textColor = common.textColor ?? '#ffffff';
  const accent = common.accentColor ?? '#a855f7';
  const cardBg = `linear-gradient(180deg, rgba(15,5,30,${0.92 * common.backgroundOpacity}), rgba(40,15,70,${0.92 * common.backgroundOpacity}))`;
  const stroke = `1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000, -1px -1px 0 #000`;

  const cardStyle: CSSProperties = {
    width: '100%', height: '100%', padding: 24, borderRadius: 12,
    background: cardBg,
    border: `2px solid ${accent}`,
    boxShadow: `0 8px 24px ${withOpacity(accent, 0.4)}`,
    fontFamily: headingFont, color: textColor,
    display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'center', gap: 12, overflow: 'hidden',
  };

  if (state.status !== 'ok') {
    return (
      <div style={{ width: '100%', height: '100%' }}>
        <div style={{ ...cardStyle, fontSize: common.scale(18), textAlign: 'center', alignItems: 'center', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800 }}>
          ★ {state.message} ★
        </div>
      </div>
    );
  }

  if (!state.hasSynced || !state.lines) {
    return (
      <PlainLyricsBody body={state.lyrics?.body ?? ''} fontSize={common.scale(20)} color={textColor} fontFamily={headingFont} fontWeight={common.fontWeight} cardStyle={cardStyle} />
    );
  }

  if (viewMode === 'karaoke') {
    const idx = state.activeIndex < 0 ? 0 : state.activeIndex;
    return (
      <div style={{ width: '100%', height: '100%' }}>
        <div style={{ ...cardStyle, alignItems: 'center', justifyContent: 'center' }}>
          {state.isWaiting && (
            <div style={{ fontSize: common.scale(12), color: accent, textTransform: 'uppercase', letterSpacing: '0.18em', fontWeight: 800 }}>
              ★ 리모컨에서 영상이나 가사를 재생시켜주세요 ★
            </div>
          )}
          <div style={{
            fontSize: common.scale(54), fontWeight: 900,
            color: state.isWaiting ? withOpacity(textColor, 0.45) : accent,
            textAlign: 'center', lineHeight: 1.05, padding: '0 16px',
            textTransform: 'uppercase', letterSpacing: '0.02em',
            textShadow: state.isWaiting ? stroke : `${stroke}, 0 0 30px ${withOpacity(accent, 0.6)}`,
            transition: 'all 240ms ease',
          }}>
            {state.lines[idx]?.text ?? ''}
          </div>
        </div>
      </div>
    );
  }

  const lineFontSize = common.scale(viewMode === 'three-line' ? 32 : 26);
  const isThreeLine = viewMode === 'three-line';
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <div style={cardStyle}>
        {state.isWaiting && (
          <div style={{ fontSize: common.scale(11), color: accent, textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.18em', fontWeight: 800 }}>
            ★ 리모컨에서 영상이나 가사를 재생시켜주세요 ★
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
          <ul style={{ listStyle: 'none', margin: 0, padding: isThreeLine ? '50% 0' : 0, fontSize: lineFontSize, lineHeight: 1.25, textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
            {state.lines.map((line, i) => {
              const isActive = !state.isWaiting && i === state.activeIndex;
              return (
                <li key={i} ref={(el) => { state.lineRefs.current[i] = el; }} style={{
                  color: isActive ? accent : textColor,
                  fontWeight: 900,
                  opacity: isActive ? 1 : 0.45,
                  transform: isActive ? 'scale(1.04)' : 'scale(1)',
                  transition: 'all 220ms cubic-bezier(0.4, 0, 0.2, 1)',
                  margin: '0.3em 0', padding: '0 12px',
                  textShadow: isActive ? `${stroke}, 0 0 20px ${withOpacity(accent, 0.5)}` : stroke,
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
