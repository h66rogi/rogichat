'use client';

import { type CSSProperties } from 'react';
import { buildFontFamilyValue, useCommonOptions, PlainLyricsBody, useLyricsState, resolveLyricsViewMode } from '../shared';
import { withOpacity } from '../shared/apply-transparency';
import type { ThemeWidgetProps } from '../types';

const SPOTIFY_GREEN = '#1ed760';

export default function Lyrics({ data, options: rawOptions, fonts }: ThemeWidgetProps) {
  const common = useCommonOptions(rawOptions);
  const viewMode = resolveLyricsViewMode((rawOptions as Record<string, unknown>)?.lyricsViewMode);
  const state = useLyricsState(data, rawOptions);
  if (state.shouldHide) return null;

  const bodyFont = common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['Pretendard', 'sans-serif']);
  const textColor = common.textColor ?? '#ffffff';
  const accent = common.accentColor ?? SPOTIFY_GREEN;
  const subtitleColor = 'rgba(179,179,179,0.9)';
  const cardBg = `rgba(18,18,18, ${0.9 * common.backgroundOpacity})`;
  const subBorder = withOpacity('rgba(255,255,255,0.06)', common.borderOpacity);
  const cardStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    padding: 24,
    borderRadius: 12,
    background: cardBg,
    border: `1px solid ${subBorder}`,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    fontFamily: bodyFont,
    color: textColor,
    overflow: 'hidden',
  };

  if (state.status !== 'ok') {
    return (
      <div style={{ width: '100%', height: '100%' }}>
        <div style={{ ...cardStyle, fontSize: common.scale(15), color: subtitleColor, textAlign: 'center' }}>
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
            <div style={{ fontSize: common.scale(13), color: subtitleColor, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              (리모컨에서 영상이나 가사를 재생시켜주세요)
            </div>
          )}
          <div
            style={{
              fontSize: common.scale(42),
              fontWeight: 700,
              color: state.isWaiting ? subtitleColor : accent,
              textAlign: 'center',
              lineHeight: 1.15,
              padding: '0 16px',
              transition: 'color 200ms ease',
              textShadow: state.isWaiting ? 'none' : `0 0 24px ${withOpacity(accent, 0.4)}`,
            }}
          >
            {state.lines[idx]?.text ?? ''}
          </div>
        </div>
      </div>
    );
  }

  const lineFontSize = common.scale(viewMode === 'three-line' ? 28 : 24);
  const isThreeLine = viewMode === 'three-line';
  const fadeMask =
    'linear-gradient(to bottom, transparent 0%, #000 22%, #000 78%, transparent 100%)';

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <div style={{ ...cardStyle, alignItems: 'stretch' }}>
        {state.isWaiting && (
          <div style={{
            fontSize: common.scale(11),
            color: subtitleColor,
            textAlign: 'center',
            textTransform: 'uppercase',
            letterSpacing: '0.15em',
            fontWeight: 700,
          }}>
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
              fontWeight: 700,
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
                    opacity: isActive ? 1 : 0.42,
                    transform: isActive ? 'scale(1.03)' : 'scale(1)',
                    transition: 'all 220ms cubic-bezier(0.4, 0, 0.2, 1)',
                    margin: '0.45em 0',
                    padding: '0 14px',
                    textShadow: isActive ? `0 0 16px ${withOpacity(accent, 0.5)}` : 'none',
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
