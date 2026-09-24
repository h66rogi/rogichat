'use client';

import { type CSSProperties } from 'react';
import { buildFontFamilyValue, useCommonOptions, PlainLyricsBody, useLyricsState, resolveLyricsViewMode } from '../shared';
import type { ThemeWidgetProps } from '../types';

export default function Lyrics({ data, options: rawOptions, fonts }: ThemeWidgetProps) {
  const common = useCommonOptions(rawOptions);
  const viewMode = resolveLyricsViewMode((rawOptions as Record<string, unknown>)?.lyricsViewMode);
  const state = useLyricsState(data, rawOptions);
  if (state.shouldHide) return null;
  const bodyFont = common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['"Caveat"', '"Comic Sans MS"', 'cursive']);
  const textColor = common.textColor ?? '#2c2c2c';
  const accent = common.accentColor ?? '#e84545';
  const cardBg = `rgba(253,251,243, ${0.97 * common.backgroundOpacity})`;
  const cardStyle: CSSProperties = {
    width: '100%', height: '100%', padding: 22,
    background: cardBg,
    border: `2.5px solid ${textColor}`,
    borderRadius: '12px 25px 18px 22px / 22px 14px 26px 16px',
    boxShadow: '3px 3px 0 rgba(0,0,0,0.8)',
    fontFamily: bodyFont, color: textColor,
    display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'center', gap: 10, overflow: 'hidden',
    transform: 'rotate(-0.3deg)',
  };

  if (state.status !== 'ok') {
    return (
      <div style={{ width: '100%', height: '100%' }}>
        <div style={{ ...cardStyle, fontSize: common.scale(20), textAlign: 'center', alignItems: 'center' }}>
          ✎ {state.message}
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
            <div style={{ fontSize: common.scale(15), opacity: 0.55 }}>(리모컨에서 영상이나 가사를 재생시켜주세요)</div>
          )}
          <div style={{
            fontSize: common.scale(46), fontWeight: 700,
            color: state.isWaiting ? 'rgba(44,44,44,0.4)' : accent,
            textAlign: 'center', lineHeight: 1.15, padding: '0 16px',
            transition: 'all 220ms ease',
            transform: state.isWaiting ? 'rotate(-1deg)' : 'rotate(0deg)',
          }}>
            {state.lines[idx]?.text ?? ''}
          </div>
        </div>
      </div>
    );
  }

  const lineFontSize = common.scale(viewMode === 'three-line' ? 28 : 24);
  const isThreeLine = viewMode === 'three-line';
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <div style={cardStyle}>
        {state.isWaiting && (
          <div style={{ fontSize: common.scale(14), opacity: 0.55, textAlign: 'center' }}>(리모컨에서 영상이나 가사를 재생시켜주세요)</div>
        )}
        <div style={{
          width: '100%',
          height: '100%',
          flex: 1,
          overflow: isThreeLine ? 'hidden' : 'auto',
          maskImage: isThreeLine ? 'linear-gradient(to bottom, transparent 0%, #000 25%, #000 75%, transparent 100%)' : undefined,
          WebkitMaskImage: isThreeLine ? 'linear-gradient(to bottom, transparent 0%, #000 25%, #000 75%, transparent 100%)' : undefined,
        }}>
          <ul style={{ listStyle: 'none', margin: 0, padding: isThreeLine ? '50% 0' : 0, fontSize: lineFontSize, lineHeight: 1.4, textAlign: 'center' }}>
            {state.lines.map((line, i) => {
              const isActive = !state.isWaiting && i === state.activeIndex;
              const tilt = isActive ? `rotate(${(i % 2 === 0 ? -0.4 : 0.4)}deg)` : 'rotate(0deg)';
              return (
                <li key={i} ref={(el) => { state.lineRefs.current[i] = el; }} style={{
                  color: isActive ? accent : textColor,
                  fontWeight: isActive ? 700 : 500,
                  opacity: isActive ? 1 : 0.5,
                  transform: isActive ? `${tilt} scale(1.04)` : 'scale(1)',
                  transition: 'all 260ms cubic-bezier(0.4, 0, 0.2, 1)',
                  margin: '0.35em 0', padding: '0 14px',
                  textDecoration: isActive ? 'underline wavy' : 'none',
                  textDecorationColor: isActive ? accent : 'transparent',
                  textUnderlineOffset: '6px',
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
