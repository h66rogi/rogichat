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
  const bodyFont = common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['Pretendard', 'sans-serif']);
  const textColor = common.textColor ?? '#ffffff';
  const accent = common.accentColor ?? '#7c3aed';
  const cardStyle: CSSProperties = {
    width: '100%', height: '100%', padding: 24, borderRadius: 20,
    background: `linear-gradient(135deg, rgba(45,30,80,${0.9 * common.backgroundOpacity}), rgba(20,10,40,${0.9 * common.backgroundOpacity}))`,
    border: `1px solid rgba(255,255,255,0.12)`,
    boxShadow: '0 16px 48px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.15)',
    fontFamily: bodyFont, color: textColor,
    display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'center', gap: 12, overflow: 'hidden',
    perspective: 1000,
  };

  if (state.status !== 'ok') {
    return (
      <div style={{ width: '100%', height: '100%' }}>
        <div style={{ ...cardStyle, fontSize: common.scale(16), textAlign: 'center', alignItems: 'center' }}>
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
        <div style={{ ...cardStyle, alignItems: 'center', justifyContent: 'center' }}>
          {state.isWaiting && (
            <div style={{ fontSize: common.scale(13), opacity: 0.55 }}>(리모컨에서 영상이나 가사를 재생시켜주세요)</div>
          )}
          <div style={{
            fontSize: common.scale(44), fontWeight: 800,
            color: state.isWaiting ? withOpacity(textColor, 0.4) : accent,
            textAlign: 'center', lineHeight: 1.15, padding: '0 16px',
            transform: state.isWaiting ? 'translateZ(0)' : 'translateZ(40px) rotateX(-3deg)',
            transformStyle: 'preserve-3d',
            transition: 'all 280ms cubic-bezier(0.4, 0, 0.2, 1)',
            textShadow: state.isWaiting ? 'none' : `2px 2px 0 ${withOpacity(accent, 0.6)}, 4px 4px 0 ${withOpacity(accent, 0.4)}, 6px 6px 12px rgba(0,0,0,0.6)`,
          }}>
            {state.lines[idx]?.text ?? ''}
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
          <div style={{ fontSize: common.scale(13), opacity: 0.55, textAlign: 'center' }}>(리모컨에서 영상이나 가사를 재생시켜주세요)</div>
        )}
        <div style={{
          width: '100%',
          height: '100%',
          flex: 1,
          overflow: isThreeLine ? 'hidden' : 'auto',
          maskImage: isThreeLine ? 'linear-gradient(to bottom, transparent 0%, #000 25%, #000 75%, transparent 100%)' : undefined,
          WebkitMaskImage: isThreeLine ? 'linear-gradient(to bottom, transparent 0%, #000 25%, #000 75%, transparent 100%)' : undefined,
          perspective: 800,
        }}>
          <ul style={{ listStyle: 'none', margin: 0, padding: isThreeLine ? '50% 0' : 0, fontSize: lineFontSize, lineHeight: 1.4, textAlign: 'center', transformStyle: 'preserve-3d' }}>
            {state.lines.map((line, i) => {
              const isActive = !state.isWaiting && i === state.activeIndex;
              return (
                <li key={i} ref={(el) => { state.lineRefs.current[i] = el; }} style={{
                  color: isActive ? accent : textColor,
                  fontWeight: isActive ? 800 : 600,
                  opacity: isActive ? 1 : 0.4,
                  transform: isActive ? 'scale(1.05) translateZ(20px)' : 'scale(1) translateZ(0)',
                  transition: 'all 240ms cubic-bezier(0.4, 0, 0.2, 1)',
                  margin: '0.4em 0', padding: '0 14px',
                  textShadow: isActive ? `2px 2px 0 ${withOpacity(accent, 0.5)}, 4px 4px 8px rgba(0,0,0,0.5)` : '1px 1px 2px rgba(0,0,0,0.3)',
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
