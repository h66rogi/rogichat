'use client';

import { useMemo, memo} from 'react';
import type { ThemeWidgetProps } from '../types';
import { buildFontFamilyValue, useCommonOptions, useQueueAnimation } from '../shared';
import { hexToRgba, buildBlurFilter } from '../shared/apply-transparency';
import { defaultOptions, type KoreanTraditionalOptions } from './config';
import type { SongRequest } from '../../types/overlay';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): KoreanTraditionalOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<KoreanTraditionalOptions>),
  };
}

// Hanmun-style numerals — 一 二 三 四 五. Used as the queue position label.
const HANMUN_NUMERALS = ['一', '二', '三', '四', '五'] as const;

function getTitle(item: SongRequest): string {
  return item.song?.title || item.rawTitle || '제목 미상';
}

function getArtist(item: SongRequest): string {
  return item.song?.artist?.name || item.rawArtist || '';
}

function withAlpha(hex: string, alpha: number): string {
  if (!hex.startsWith('#') || hex.length !== 7) return hex;
  const a = Math.max(0, Math.min(255, Math.round(alpha))).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

function Queue({
  data,
  options: rawOptions,
  animations,
  fonts,
  reducedMotion,
}: Props) {
  const options = useMemo(() => resolveOptions(rawOptions), [rawOptions]);
  const common = useCommonOptions(rawOptions);
  const headingFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.heading ?? ['Noto Serif KR', 'serif']),
    [common.fontFamily, fonts.roles.heading],
  );
  const bodyFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['Noto Serif KR', 'serif']),
    [common.fontFamily, fonts.roles.body],
  );

  const queue = useMemo(() => data?.queue ?? [], [data?.queue]);

  const { animatedItems } = useQueueAnimation<SongRequest>({
    items: queue,
    getItemId: (item) => String(item.id),
    addAnimation: animations['queue.add'],
    removeAnimation: animations['queue.remove'],
    reducedMotion,
  });

  const baseColor = options.baseColor || defaultOptions.baseColor;
  const inkColor = common.textColor ?? options.inkColor ?? defaultOptions.inkColor;
  const accentRed = common.accentColor ?? options.accentRed ?? defaultOptions.accentRed;
  const accentBrown = options.accentBrown || defaultOptions.accentBrown;

  const enterDuration = animations['queue.add']?.enterDuration ?? 400;
  const stagger = animations['queue.add']?.stagger ?? 80;

  const containerStyle: React.CSSProperties = useMemo(() => ({
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: bodyFont,
    fontWeight: common.fontWeight,
    color: inkColor,
    background: 'transparent',
    boxSizing: 'border-box',
  }), [bodyFont, common.textSizeMultiplier, common.fontWeight, inkColor]);

  const paperStyle: React.CSSProperties = useMemo(() => ({
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    backgroundColor: hexToRgba(baseColor, common.backgroundOpacity),
    backgroundImage: [
      `radial-gradient(ellipse at 20% 15%, rgba(255, 255, 255, ${0.45 * common.backgroundOpacity}), transparent 55%)`,
      `radial-gradient(ellipse at 80% 85%, ${hexToRgba(accentBrown, (22 / 255) * common.backgroundOpacity)}, transparent 60%)`,
      `repeating-radial-gradient(circle at 30% 40%, ${hexToRgba(inkColor, (8 / 255) * common.backgroundOpacity)} 0, ${hexToRgba(inkColor, (8 / 255) * common.backgroundOpacity)} 1px, transparent 1px, transparent 6px)`,
    ].join(', '),
    padding: 26,
    position: 'relative',
    boxShadow: `inset 0 1px 0 rgba(255, 255, 255, ${0.6 * common.backgroundOpacity})`,
    borderRadius: 2,
    boxSizing: 'border-box',
    overflow: 'hidden',
    backdropFilter: buildBlurFilter(common.blurIntensity),
    WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
  }), [accentBrown, baseColor, inkColor, common.backgroundOpacity, common.blurIntensity]);

  const innerBorderStyle: React.CSSProperties = useMemo(() => ({
    position: 'absolute',
    top: 8,
    right: 8,
    bottom: 8,
    left: 8,
    border: `2px solid ${withAlpha(accentBrown, 90 * common.borderOpacity)}`,
    pointerEvents: 'none',
    borderRadius: 1,
  }), [accentBrown, common.borderOpacity]);

  const innerContentStyle: React.CSSProperties = useMemo(() => ({
    position: 'relative',
    flex: 1,
    minHeight: 0,
    padding: '20px 14px 22px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 12,
    textAlign: 'center',
  }), []);

  const headerStyle: React.CSSProperties = useMemo(() => ({
    fontFamily: bodyFont,
    fontSize: common.scale(13),
    letterSpacing: 4,
    color: accentBrown,
    margin: 0,
    paddingBottom: 10,
    borderBottom: `1px solid ${withAlpha(accentBrown, 80)}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  }), [accentBrown, bodyFont, common.textSizeMultiplier]);

  const isEmpty = queue.length === 0;
  const totalCount = (data?.queue ?? []).length;

  return (
    <div style={containerStyle}>
      <div style={paperStyle}>
        <div style={innerBorderStyle} aria-hidden="true" />
        <div style={innerContentStyle}>
          <div style={headerStyle}>
            <span>대 기 곡</span>
            <span
              style={{
                fontSize: common.scale(12),
                letterSpacing: 1,
                color: accentRed,
                fontFamily: headingFont,
                fontWeight: 700,
              }}
            >
              {totalCount}
            </span>
          </div>

          {isEmpty ? (
            <div
              style={{
                fontFamily: headingFont,
                fontSize: common.scale(14),
                fontStyle: 'italic',
                color: accentBrown,
                opacity: 0.7,
                padding: '20px 4px',
              }}
            >
              대기곡 없음
            </div>
          ) : (
            <ul data-overlay-scroll
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                minHeight: 0,
                overflow: 'hidden',
              }}
            >
              {animatedItems.map(({ item, phase, index }) => {
                const isDonation = (item.donationAmount ?? 0) > 0;
                const isHomework = !!item.isHomework;

                const isRandom = !!item.isRandom;
                const isLast = index === animatedItems.length - 1;

                const animationCss =
                  phase === 'entering' && !reducedMotion
                    ? `korean-traditional-soft-fade ${enterDuration}ms ease-out ${
                        stagger * index
                      }ms 1 both`
                    : undefined;

                return (
                  <li
                    key={item.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 12,
                      padding: '10px 6px',
                      borderBottom: isLast
                        ? 'none'
                        : `1px dashed ${withAlpha(accentBrown, 70)}`,
                      animation: animationCss,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: headingFont,
                        fontSize: common.scale(16),
                        fontWeight: 700,
                        color: accentRed,
                        flexShrink: 0,
                        minWidth: 18,
                      }}
                    >
                      {HANMUN_NUMERALS[index] ?? String(index + 1)}
                    </span>
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        textAlign: 'center',
                      }}
                    >
                      <div
                        style={{
                          fontFamily: headingFont,
                          fontSize: common.scale(18),
                          fontWeight: 700,
                          color: inkColor,
                          lineHeight: 1.25,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {getTitle(item)}
                      </div>
                      <div
                        style={{
                          fontFamily: bodyFont,
                          fontSize: common.scale(16),
                          color: accentBrown,
                          marginTop: 3,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {getArtist(item)}
                        {data.settings?.showRequesterName !== false && item.requesterNickname ? (
                          <span style={{ opacity: 0.75 }}>
                            {' '}· @{item.requesterNickname}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 3,
                        alignItems: 'flex-end',
                        minWidth: 28,
                      }}
                    >
                      {isDonation && (
                        <span
                          style={{
                            fontFamily: bodyFont,
                            fontSize: common.scale(11),
                            color: accentRed,
                            border: `1px solid ${withAlpha(accentRed, 160)}`,
                            padding: '1px 5px',
                            letterSpacing: 1,
                            borderRadius: 1,
                          }}
                        >
                          후원
                        </span>
                      )}
                      {isHomework && (
                        <span
                          style={{
                            fontFamily: bodyFont,
                            fontSize: common.scale(11),
                            color: accentBrown,
                            border: `1px solid ${withAlpha(accentBrown, 130)}`,
                            padding: '1px 5px',
                            letterSpacing: 1,
                            borderRadius: 1,
                          }}
                        >
                          숙제
                        </span>
                      )}

                      {isRandom && (
                        <span
                          style={{
                            fontFamily: bodyFont,
                            fontSize: common.scale(11),
                            color: accentBrown,
                            border: `1px solid ${withAlpha(accentBrown, 130)}`,
                            padding: '1px 5px',
                            letterSpacing: 1,
                            borderRadius: 1,
                          }}
                        >
                          랜덤
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
Queue.displayName = 'Queue';
export default memo(Queue);
