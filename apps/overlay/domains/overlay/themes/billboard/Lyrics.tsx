'use client';

import { type CSSProperties } from 'react';
import {
  buildFontFamilyValue,
  useCommonOptions,
  PlainLyricsBody,
  useLyricsState,
  resolveLyricsViewMode,
  resolveTextStroke,
  withTextStroke,
  buildTextStrokeStyle,
} from '../shared';
import type { ThemeWidgetProps } from '../types';

/**
 * Billboard 가사 — 투명 배경, 거대한 BOLD 텍스트 + drop-letter (텍스트 only).
 * Billboard 테마는 카드/배경 없이 화면 위에 텍스트만 떠 있음 (poster 톤)
 * 이라 가독성 보강을 위해 textStroke 옵션 (drop-letter) 을 적용한다.
 */
export default function Lyrics({ data, options: rawOptions, fonts }: ThemeWidgetProps) {
  const common = useCommonOptions(rawOptions);
  const viewMode = resolveLyricsViewMode((rawOptions as Record<string, unknown>)?.lyricsViewMode);
  const state = useLyricsState(data, rawOptions);
  if (state.shouldHide) return null;

  const headingFont = common.fontFamily ?? buildFontFamilyValue(
    fonts.roles.heading ?? ['Pretendard', 'sans-serif'],
  );
  const textColor = common.textColor ?? '#ffffff';
  const accent = common.accentColor ?? '#FFD60A';
  const subtitleColor = 'rgba(255,255,255,0.7)';

  const stroke = resolveTextStroke(rawOptions as Record<string, unknown> | undefined);
  const lyricsStroke = withTextStroke(stroke);
  const containerStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    background: 'transparent',
    fontFamily: headingFont,
    color: textColor,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    overflow: 'hidden',
    ...buildTextStrokeStyle(stroke),
  };

  if (state.status !== 'ok') {
    return (
      <div style={containerStyle}>
        <div
          style={{
            fontSize: common.scale(20),
            color: subtitleColor,
            textAlign: 'center',
            fontWeight: 800,
            letterSpacing: '0.02em',
            textTransform: 'uppercase',
            textShadow: lyricsStroke,
          }}
        >
          {state.message}
        </div>
      </div>
    );
  }

  if (!state.hasSynced || !state.lines) {
    return (
      <PlainLyricsBody body={state.lyrics?.body ?? ''} fontSize={common.scale(20)} color={textColor} fontFamily={headingFont} fontWeight={common.fontWeight} cardStyle={containerStyle} />
    );
  }

  if (viewMode === 'karaoke') {
    const idx = state.activeIndex < 0 ? 0 : state.activeIndex;
    return (
      <div style={containerStyle}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          {state.isWaiting && (
            <div style={{
              fontSize: common.scale(14),
              color: subtitleColor,
              textShadow: lyricsStroke,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}>
              (리모컨에서 영상이나 가사를 재생시켜주세요)
            </div>
          )}
          <div
            style={{
              fontSize: common.scale(56),
              fontWeight: 900,
              color: state.isWaiting ? subtitleColor : accent,
              textAlign: 'center',
              lineHeight: 1.05,
              letterSpacing: '-0.02em',
              textShadow: lyricsStroke,
              textTransform: 'uppercase',
            }}
          >
            {state.lines[idx]?.text ?? ''}
          </div>
        </div>
      </div>
    );
  }

  const lineFontSize = common.scale(viewMode === 'three-line' ? 36 : 30);
  const isThreeLine = viewMode === 'three-line';
  const fadeMask =
    'linear-gradient(to bottom, transparent 0%, #000 25%, #000 75%, transparent 100%)';

  return (
    <div style={containerStyle}>
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        {state.isWaiting && (
          <div style={{
            fontSize: common.scale(13),
            color: subtitleColor,
            textAlign: 'center',
            fontWeight: 800,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            textShadow: lyricsStroke,
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
              lineHeight: 1.25,
              textAlign: 'center',
              fontWeight: 900,
              letterSpacing: '-0.01em',
              textTransform: 'uppercase',
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
                    opacity: isActive ? 1 : 0.55,
                    transform: isActive ? 'scale(1.05)' : 'scale(1)',
                    transition: 'all 220ms cubic-bezier(0.4, 0, 0.2, 1)',
                    margin: '0.3em 0',
                    padding: '0 12px',
                    textShadow: lyricsStroke,
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
