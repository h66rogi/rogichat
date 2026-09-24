'use client';

import { useEffect, useMemo, useRef, type CSSProperties, memo} from 'react';
import type { ThemeWidgetProps } from '../types';
import type { OverlayChatEvent } from '@/domains/overlay/types/chat';
import { ChatMessageContent } from '@/domains/overlay/components/shared/ChatMessageContent';
import {
  buildFontFamilyValue,
  useChatAnimation,
  useCommonOptions,
  useDonationAnimation,
} from '../shared';
import { withOpacity, buildBlurFilter } from '../shared/apply-transparency';
import {
  type AppleLayoutOptions,
  DEFAULT_LAYOUT_OPTIONS,
} from '@/domains/overlay/types/options';

type Props = ThemeWidgetProps;

const PLATFORM_LABEL: Record<string, string> = {
  chzzk: 'CHZZK',
  soop: 'SOOP',
  cime: 'CIME',
  meloming: 'MELOMING',
};

const PLATFORM_COLOR: Record<string, string> = {
  chzzk: '#00FFA3',
  soop: '#0067FF',
  cime: '#FF6B6B',
  meloming: '#FA243C',
};

const MAX_VISIBLE_DEFAULT = 30;

function resolveOptions(raw: Record<string, unknown>): AppleLayoutOptions {
  return {
    ...DEFAULT_LAYOUT_OPTIONS.apple,
    ...(raw as Partial<AppleLayoutOptions>),
  };
}

function platformLabel(platform: string): string {
  return PLATFORM_LABEL[platform] ?? platform.toUpperCase();
}

function platformColor(platform: string, fallback: string): string {
  return PLATFORM_COLOR[platform] ?? fallback;
}

function isDonationEvent(event: OverlayChatEvent): boolean {
  return event.type === 'donation';
}

function formatAmount(event: OverlayChatEvent): string | null {
  if (event.type !== 'donation') return null;
  const amount = event.amountKrw ?? event.amount;
  if (typeof amount !== 'number' || amount <= 0) return null;
  return `${amount.toLocaleString('ko-KR')}원`;
}

function Chatbox({
  options: rawOptions,
  animations,
  fonts,
  reducedMotion,
  chatMessages,
}: Props) {
  const opts = useMemo(() => resolveOptions(rawOptions), [rawOptions]);
  const common = useCommonOptions(rawOptions);
  const headingFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.heading ?? ['Pretendard', 'sans-serif']),
    [common.fontFamily, fonts.roles.heading],
  );
  const bodyFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['Pretendard', 'sans-serif']),
    [common.fontFamily, fonts.roles.body],
  );

  const isDark = opts.theme === 'dark';
  const accent = common.accentColor ?? opts.accentColor ?? '#FA243C';

  const baseAlpha = isDark ? 0.75 : 0.85;
  const cardBg = isDark
    ? `rgba(0, 0, 0, ${baseAlpha * common.backgroundOpacity})`
    : `rgba(255, 255, 255, ${baseAlpha * common.backgroundOpacity})`;
  const textColor = common.textColor ?? (isDark ? '#ffffff' : '#1d1d1f');
  const mutedColor = isDark ? 'rgba(255, 255, 255, 0.6)' : 'rgba(0, 0, 0, 0.5)';
  const subBg = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)';
  const subBorder = withOpacity(
    isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(0, 0, 0, 0.06)',
    common.borderOpacity,
  );
  const donationBg = isDark
    ? 'rgba(250, 36, 60, 0.18)'
    : 'rgba(250, 36, 60, 0.10)';

  const visibleMessages = useMemo<OverlayChatEvent[]>(() => {
    const source = chatMessages ?? [];
    if (source.length <= MAX_VISIBLE_DEFAULT) return source;
    return source.slice(-MAX_VISIBLE_DEFAULT);
  }, [chatMessages]);

  const { animatedMessages } = useChatAnimation<OverlayChatEvent>({
    messages: visibleMessages,
    getMessageId: (msg) => msg.id,
    enterAnimation: animations['chat.enter'],
    exitAnimation: animations['chat.exit'],
    reducedMotion,
  });

  const { isPlaying: donationFlash, trigger: triggerDonation } = useDonationAnimation({
    animation: animations.donation,
    reducedMotion,
  });

  useEffect(() => {
    const hasDonation = animatedMessages.some(
      (m) => isDonationEvent(m.message) && m.phase === 'entering',
    );
    if (hasDonation) triggerDonation();
  }, [animatedMessages, triggerDonation]);

  const enterDuration = animations['chat.enter']?.enterDuration ?? 220;
  const stagger = animations['chat.enter']?.stagger ?? 24;
  const exitDuration = animations['chat.exit']?.enterDuration ?? 160;
  const donationDuration = animations.donation?.enterDuration ?? 600;

  const containerStyle: CSSProperties = useMemo(() => ({
    width: '100%',
    height: '100%',
    fontFamily: bodyFont,
    fontWeight: common.fontWeight,
    color: textColor,
    background: 'transparent',
  }), [bodyFont, common.textSizeMultiplier, common.fontWeight, textColor]);

  const cardStyle: CSSProperties = useMemo(() => {
    const filter = buildBlurFilter(common.blurIntensity, 'saturate(160%)');
    return {
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      padding: 16,
      borderRadius: 18,
      backgroundColor: cardBg,
      backdropFilter: filter,
      WebkitBackdropFilter: filter,
      border: `1px solid ${subBorder}`,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      position: 'relative',
      boxShadow:
        donationFlash && !reducedMotion
          ? `inset 0 0 0 2px ${accent}, 0 0 24px ${accent}66`
          : isDark
            ? '0 6px 24px rgba(0,0,0,0.35)'
            : '0 6px 20px rgba(0,0,0,0.08)',
      transition: 'box-shadow 220ms ease-out',
    };
  }, [accent, cardBg, common.blurIntensity, donationFlash, isDark, reducedMotion, subBorder]);

  const listRef = useRef<HTMLUListElement>(null);
  // 새 메시지 도착 시 하단 고정 스크롤
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [animatedMessages.length]);

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingBottom: 12,
            marginBottom: 12,
            borderBottom: `1px solid ${subBorder}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: accent,
                boxShadow: `0 0 8px ${accent}`,
              }}
            />
            <h2
              style={{
                fontFamily: headingFont,
                fontWeight: 700,
                fontSize: common.scale(18),
                letterSpacing: -0.4,
                margin: 0,
                color: textColor,
              }}
            >
              실시간 채팅
            </h2>
          </div>
          <span
            style={{
              fontSize: common.scale(12),
              color: mutedColor,
              fontFamily: bodyFont,
            }}
          >
            {animatedMessages.length}
          </span>
        </div>

        {animatedMessages.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: mutedColor,
              fontSize: common.scale(14),
            }}
          >
            채팅을 기다리는 중...
          </div>
        ) : (
          <ul
            ref={listRef}
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              justifyContent: 'flex-end',
              overflow: 'hidden auto',
              scrollbarWidth: 'none',
            }}
          >
            {animatedMessages.map(({ message, phase, index }) => {
              const isDonation = isDonationEvent(message);
              const animationCss =
                phase === 'entering' && !reducedMotion
                  ? `apple-chat-enter ${enterDuration}ms cubic-bezier(0.22,1,0.36,1) ${stagger * Math.min(index, 4)}ms 1 both`
                  : phase === 'exiting' && !reducedMotion
                    ? `apple-chat-exit ${exitDuration}ms ease-in 0ms 1 both`
                    : undefined;
              const donationCss =
                isDonation && phase === 'entering' && !reducedMotion
                  ? `, apple-donation-pulse ${donationDuration}ms ease-out ${stagger * Math.min(index, 4)}ms 1 both`
                  : '';
              const platColor = platformColor(message.platform, accent);
              const amount = formatAmount(message);

              return (
                <li
                  key={message.id}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 12,
                    backgroundColor: isDonation ? donationBg : subBg,
                    border: `1px solid ${isDonation ? `${accent}55` : subBorder}`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    animation: `${animationCss ?? ''}${donationCss}` || undefined,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span
                      style={{
                        fontSize: common.scale(10),
                        fontWeight: 700,
                        letterSpacing: 0.6,
                        padding: '2px 6px',
                        borderRadius: 999,
                        backgroundColor: `${platColor}22`,
                        color: platColor,
                        textTransform: 'uppercase',
                      }}
                    >
                      {platformLabel(message.platform)}
                    </span>
                    <span
                      style={{
                        fontSize: common.scale(13),
                        fontWeight: 600,
                        color: isDonation ? accent : textColor,
                        maxWidth: '60%',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {message.nickname}
                    </span>
                    {amount && (
                      <span
                        style={{
                          marginLeft: 'auto',
                          fontSize: common.scale(12),
                          fontWeight: 700,
                          color: accent,
                          letterSpacing: -0.2,
                        }}
                      >
                        🎁 {amount}
                      </span>
                    )}
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: common.scale(14),
                      lineHeight: 1.4,
                      color: textColor,
                      wordBreak: 'break-word',
                    }}
                  >
                    <ChatMessageContent message={message.message} platform={message.platform} emotes={message.emotes} />
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <style>{`
        @keyframes apple-chat-enter {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes apple-chat-exit {
          from { opacity: 1; transform: translateY(0); }
          to { opacity: 0; transform: translateY(-4px); }
        }
        @keyframes apple-donation-pulse {
          0% { box-shadow: 0 0 0 0 ${accent}66; }
          60% { box-shadow: 0 0 0 8px ${accent}00; }
          100% { box-shadow: 0 0 0 0 ${accent}00; }
        }
      `}</style>
    </div>
  );
}
Chatbox.displayName = 'Chatbox';
export default memo(Chatbox);
