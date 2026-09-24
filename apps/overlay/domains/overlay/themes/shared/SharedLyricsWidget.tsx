'use client';

import { type CSSProperties } from 'react';
import type { ThemeWidgetProps } from '../types';
import { buildFontFamilyValue, useCommonOptions } from './index';
import { PlainLyricsBody } from './PlainLyricsBody';
import { withOpacity } from './apply-transparency';
import { useLyricsState, resolveLyricsViewMode } from './use-lyrics-state';

/**
 * 14개 테마 fallback 공용 lyrics widget. 테마가 자체 Lyrics.tsx 를 가지지 않을
 * 때만 사용. 가사 fetch + RAF + scrollIntoView 는 useLyricsState 에 통합되어
 * 있어 여기에는 useEffect 가 0개 — early return 후 hook 호출이 없어야 React
 * #310 (Rendered more hooks…) 이 발생하지 않음.
 */
export function SharedLyricsWidget({ data, options: rawOptions, fonts }: ThemeWidgetProps) {
  const common = useCommonOptions(rawOptions);
  const viewMode = resolveLyricsViewMode((rawOptions as Record<string, unknown>)?.lyricsViewMode);
  const state = useLyricsState(data, rawOptions);
  if (state.shouldHide) return null;

  const bodyFont = common.fontFamily ?? buildFontFamilyValue(
    fonts.roles.body ?? ['Pretendard', 'sans-serif'],
  );
  const textColor = common.textColor ?? '#ffffff';
  const accent = common.accentColor ?? '#FA243C';
  const subtitleColor = withOpacity(textColor, 0.5);
  const baseAlpha = 0.55 * common.backgroundOpacity;
  const cardBg = `rgba(0, 0, 0, ${baseAlpha})`;
  const subBorder = withOpacity('rgba(255,255,255,0.18)', common.borderOpacity);

  const cardStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    padding: 24,
    borderRadius: 16,
    background: cardBg,
    border: `1px solid ${subBorder}`,
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    gap: 12,
    fontFamily: bodyFont,
    color: textColor,
  };

  if (state.status !== 'ok') {
    return (
      <div style={{ width: '100%', height: '100%' }}>
        <div style={{ ...cardStyle, fontSize: common.scale(16), color: subtitleColor, textAlign: 'center' }}>
          {state.message}
        </div>
      </div>
    );
  }

  if (!state.hasSynced || !state.lines) {
    return (
      <PlainLyricsBody
        body={state.lyrics?.body ?? ''}
        fontSize={common.scale(20)}
        color={textColor}
        fontFamily={bodyFont}
        fontWeight={common.fontWeight}
        cardStyle={cardStyle}
      />
    );
  }

  if (viewMode === 'karaoke') {
    const idx = state.activeIndex < 0 ? 0 : state.activeIndex;
    return (
      <div style={{ width: '100%', height: '100%' }}>
        <div style={cardStyle}>
          {state.isWaiting && (
            <div style={{ fontSize: common.scale(14), color: subtitleColor, textAlign: 'center' }}>
              (리모컨에서 영상이나 가사를 재생시켜주세요)
            </div>
          )}
          <div
            style={{
              fontSize: common.scale(40),
              fontWeight: 700,
              color: state.isWaiting ? subtitleColor : accent,
              textAlign: 'center',
              lineHeight: 1.2,
              padding: '0 16px',
              transition: 'color 200ms ease',
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
          <div style={{ fontSize: common.scale(13), color: subtitleColor, textAlign: 'center' }}>
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
              fontWeight: common.fontWeight,
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
                    fontWeight: isActive ? 700 : common.fontWeight,
                    opacity: isActive ? 1 : 0.45,
                    transform: isActive ? 'scale(1.04)' : 'scale(1)',
                    transition: 'all 220ms cubic-bezier(0.4, 0, 0.2, 1)',
                    margin: '0.4em 0',
                    padding: '0 16px',
                    willChange: 'transform, opacity, color',
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

export default SharedLyricsWidget;
