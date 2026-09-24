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
import { hexToRgba, buildBlurFilter } from '../shared/apply-transparency';
import {
  type SpotifyLayoutOptions,
  DEFAULT_LAYOUT_OPTIONS,
} from '@/domains/overlay/types/options';

type Props = ThemeWidgetProps;

const PLATFORM_LABEL: Record<string, string> = {
  chzzk: 'CHZZK',
  soop: 'SOOP',
  cime: 'CIME',
  meloming: 'MELOMING',
};

const MAX_VISIBLE_DEFAULT = 30;

function resolveOptions(raw: Record<string, unknown>): SpotifyLayoutOptions {
  return {
    ...DEFAULT_LAYOUT_OPTIONS.spotify,
    ...(raw as Partial<SpotifyLayoutOptions>),
  };
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

function platformLabel(platform: string): string {
  return PLATFORM_LABEL[platform] ?? platform.toUpperCase();
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

const NICK_PALETTE = [
  '#1DB954', '#1ED760', '#3BE585', '#22C55E', '#A7F432', '#84CC16',
  '#F472B6', '#EC4899', '#A78BFA', '#8B5CF6', '#60A5FA', '#3B82F6',
  '#FBBF24', '#F59E0B', '#FB923C', '#F97316',
];

function nickColor(nick: string): string {
  let hash = 0;
  for (let i = 0; i < nick.length; i++) hash = (hash * 31 + nick.charCodeAt(i)) >>> 0;
  return NICK_PALETTE[hash % NICK_PALETTE.length];
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

  const accent = common.accentColor ?? opts.progressBarColor ?? '#1DB954';
  const baseBg = opts.backgroundColor || '#191414';
  const bodyTextColor = common.textColor ?? '#ffffff';
  const blurFilter = buildBlurFilter(common.blurIntensity);

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

  const enterDuration = animations['chat.enter']?.enterDuration ?? 240;
  const stagger = animations['chat.enter']?.stagger ?? 24;
  const exitDuration = animations['chat.exit']?.enterDuration ?? 160;

  const containerStyle: CSSProperties = useMemo(() => ({
    width: '100%',
    height: '100%',
    fontFamily: bodyFont,
    fontWeight: common.fontWeight,
    color: bodyTextColor,
    background: 'transparent',
  }), [bodyFont, common.textSizeMultiplier, common.fontWeight, bodyTextColor]);

  const cardStyle: CSSProperties = useMemo(() => {
    const computedBg = hexToRgba(baseBg, common.backgroundOpacity);
    return {
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      padding: 16,
      borderRadius: 12,
      backgroundColor: computedBg,
      backdropFilter: blurFilter,
      WebkitBackdropFilter: blurFilter,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      position: 'relative',
      boxShadow:
        donationFlash && !reducedMotion
          ? `inset 0 0 0 2px ${accent}, 0 0 28px ${accent}55`
          : '0 8px 32px rgba(0,0,0,0.4)',
      transition: 'box-shadow 220ms ease-out',
    };
  }, [accent, baseBg, blurFilter, common.backgroundOpacity, donationFlash, reducedMotion]);

  const listRef = useRef<HTMLUListElement>(null);
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
            gap: 10,
            paddingBottom: 12,
            marginBottom: 12,
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <span
            style={{
              width: 18,
              height: 18,
              borderRadius: '50%',
              backgroundColor: accent,
              display: 'inline-block',
              boxShadow: `0 0 6px ${accent}`,
            }}
          />
          <h2
            style={{
              fontFamily: headingFont,
              fontWeight: 700,
              fontSize: common.scale(16),
              letterSpacing: -0.3,
              margin: 0,
              color: '#ffffff',
              textTransform: 'uppercase',
            }}
          >
            Live Chat
          </h2>
          <span
            style={{
              marginLeft: 'auto',
              fontSize: common.scale(12),
              color: 'rgba(255,255,255,0.5)',
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
              color: 'rgba(255,255,255,0.4)',
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
              gap: 10,
              justifyContent: 'flex-end',
              overflow: 'hidden auto',
              scrollbarWidth: 'none',
            }}
          >
            {animatedMessages.map(({ message, phase, index }) => {
              const isDonation = isDonationEvent(message);
              const animationCss =
                phase === 'entering' && !reducedMotion
                  ? `spotify-chat-enter ${enterDuration}ms cubic-bezier(0.22,1,0.36,1) ${stagger * Math.min(index, 4)}ms 1 both`
                  : phase === 'exiting' && !reducedMotion
                    ? `spotify-chat-exit ${exitDuration}ms ease-in 0ms 1 both`
                    : undefined;
              const userColor = nickColor(message.nickname);
              const amount = formatAmount(message);

              return (
                <li
                  key={message.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    padding: isDonation ? '10px 12px' : '4px 0',
                    borderRadius: isDonation ? 10 : 0,
                    backgroundColor: isDonation ? `${accent}22` : 'transparent',
                    borderLeft: isDonation ? `3px solid ${accent}` : 'none',
                    animation: animationCss,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 6,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span
                      style={{
                        fontSize: common.scale(9),
                        fontWeight: 700,
                        letterSpacing: 1,
                        color: 'rgba(255,255,255,0.45)',
                      }}
                    >
                      {platformLabel(message.platform)}
                    </span>
                    <span
                      style={{
                        fontSize: common.scale(13),
                        fontWeight: 700,
                        color: isDonation ? accent : userColor,
                        letterSpacing: -0.2,
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
                      lineHeight: 1.45,
                      color: 'rgba(255,255,255,0.92)',
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
        @keyframes spotify-chat-enter {
          from { opacity: 0; transform: translateX(-6px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes spotify-chat-exit {
          from { opacity: 1; transform: translateX(0); }
          to { opacity: 0; transform: translateX(6px); }
        }
      `}</style>
    </div>
  );
}
Chatbox.displayName = 'Chatbox';
export default memo(Chatbox);
