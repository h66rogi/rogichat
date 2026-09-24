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
  const bodyFont = common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['"Inter"', 'sans-serif']);
  const textColor = common.textColor ?? '#000000';
  const accent = common.accentColor ?? '#FFFC00';
  const cardStyle: CSSProperties = {
    width: '100%', height: '100%', padding: 24,
    background: withOpacity(accent, 0.95 * common.backgroundOpacity),
    border: '6px solid #000', borderRadius: 0,
    boxShadow: '12px 12px 0 #000',
    fontFamily: bodyFont, color: textColor,
    display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'center', gap: 8, overflow: 'hidden',
  };

  if (state.status !== 'ok') {
    return (
      <div style={{ width: '100%', height: '100%' }}>
        <div style={{ ...cardStyle, fontSize: common.scale(18), textAlign: 'center', fontWeight: 900, textTransform: 'uppercase' }}>
          {`// ${state.message}`}
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
            <div style={{ fontSize: common.scale(12), fontWeight: 900, textTransform: 'uppercase', textAlign: 'center', borderBottom: '3px solid #000', paddingBottom: 6 }}>
              {'>> 리모컨에서 영상이나 가사를 재생시켜주세요'}
            </div>
          )}
          <div style={{
            fontSize: common.scale(48), fontWeight: 900, textTransform: 'uppercase',
            textAlign: 'center', lineHeight: 1.05, letterSpacing: '-0.02em',
            color: state.isWaiting ? 'rgba(0,0,0,0.45)' : '#000',
          }}>
            {state.lines[idx]?.text ?? ''}
          </div>
        </div>
      </div>
    );
  }

  const lineFontSize = common.scale(viewMode === 'three-line' ? 30 : 24);
  const isThreeLine = viewMode === 'three-line';
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <div style={cardStyle}>
        {state.isWaiting && (
          <div style={{ fontSize: common.scale(11), fontWeight: 900, textTransform: 'uppercase', textAlign: 'center', borderBottom: '3px solid #000', paddingBottom: 6 }}>
            {'>> 리모컨에서 영상이나 가사를 재생시켜주세요'}
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
          <ul style={{ listStyle: 'none', margin: 0, padding: isThreeLine ? '50% 0' : 0, fontSize: lineFontSize, lineHeight: 1.3, textAlign: 'center', textTransform: 'uppercase', letterSpacing: '-0.02em' }}>
            {state.lines.map((line, i) => {
              const isActive = !state.isWaiting && i === state.activeIndex;
              return (
                <li key={i} ref={(el) => { state.lineRefs.current[i] = el; }} style={{
                  color: isActive ? accent : '#000',
                  fontWeight: 900,
                  opacity: isActive ? 1 : 0.5,
                  transform: isActive ? 'scale(1.05)' : 'scale(1)',
                  transition: 'all 180ms cubic-bezier(0.4, 0, 0.2, 1)',
                  margin: '0.3em 0', padding: '0 12px',
                  background: isActive ? '#000' : 'transparent',
                  display: 'inline-block',
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
