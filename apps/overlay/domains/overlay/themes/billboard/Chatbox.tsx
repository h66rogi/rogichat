'use client';

import { useEffect, useMemo, useRef, type CSSProperties, memo} from 'react';
import type { ThemeWidgetProps } from '../types';
import type { OverlayChatEvent } from '@/domains/overlay/types/chat';
import { ChatMessageContent } from '@/domains/overlay/components/shared/ChatMessageContent';
import {
  buildFontFamilyValue,
  useChatAnimation,
  useCommonOptions,
  useContainerUnitsSupport,
  useDonationAnimation,
  cqwCap,
  fluidOr,
  resolveTextStroke,
  withTextStroke,
  buildTextStrokeStyle,
} from '../shared';
import { buildBlurFilter } from '../shared/apply-transparency';
import {
  type BillboardLayoutOptions,
  DEFAULT_LAYOUT_OPTIONS,
} from '@/domains/overlay/types/options';

type Props = ThemeWidgetProps;

const PLATFORM_LABEL: Record<string, string> = {
  chzzk: 'CHZZK',
  soop: 'SOOP',
  cime: 'CIME',
  meloming: 'MELOMING',
};

const MAX_VISIBLE_DEFAULT = 20;

function resolveOptions(raw: Record<string, unknown>): BillboardLayoutOptions {
  return {
    ...DEFAULT_LAYOUT_OPTIONS.billboard,
    ...(raw as Partial<BillboardLayoutOptions>),
  };
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

function Chatbox({
  options: rawOptions,
  animations,
  fonts,
  reducedMotion,
  chatMessages,
}: Props) {
  const opts = useMemo(() => resolveOptions(rawOptions), [rawOptions]);
  const common = useCommonOptions(rawOptions);
  const supportsCq = useContainerUnitsSupport();
  const headingFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(
      fonts.roles.heading ?? ['Oswald', 'Impact', 'sans-serif'],
    ),
    [common.fontFamily, fonts.roles.heading],
  );
  const bodyFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['Pretendard', 'sans-serif']),
    [common.fontFamily, fonts.roles.body],
  );

  const textColor = common.textColor ?? opts.textColor ?? '#FFFFFF';
  const accent = common.accentColor ?? '#FFD60A';
  const donationRed = '#E5272B';

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
  const stagger = animations['chat.enter']?.stagger ?? 30;
  const exitDuration = animations['chat.exit']?.enterDuration ?? 150;

  const blurFilter = buildBlurFilter(common.blurIntensity);
  const stroke = useMemo(() => resolveTextStroke(rawOptions), [rawOptions]);
  const combinedShadow = useMemo(
    () =>
      withTextStroke(
        stroke,
        opts.transparentBackground ? '0 2px 8px rgba(0,0,0,0.65)' : undefined,
      ),
    [stroke, opts.transparentBackground],
  );
  const strokeStyle = useMemo(() => buildTextStrokeStyle(stroke), [stroke]);

  const containerStyle: CSSProperties = useMemo(() => ({
    width: '100%',
    height: '100%',
    fontFamily: bodyFont,
    fontWeight: common.fontWeight,
    color: textColor,
    background: opts.transparentBackground
      ? 'transparent'
      : `rgba(11, 11, 11, ${common.backgroundOpacity})`,
    backdropFilter: blurFilter,
    WebkitBackdropFilter: blurFilter,
    containerType: supportsCq ? 'inline-size' : undefined,
    padding: fluidOr('12px', 'min(12px, 2.5cqw)', supportsCq),
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'visible',
    position: 'relative',
    textShadow: combinedShadow,
    ...strokeStyle,
  }), [blurFilter, bodyFont, common.backgroundOpacity, common.textSizeMultiplier, common.fontWeight, opts, supportsCq, textColor, combinedShadow, strokeStyle]);

  const flashStyle: CSSProperties = useMemo(() => ({
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    border: `4px solid ${donationRed}`,
    opacity: donationFlash && !reducedMotion ? 1 : 0,
    transition: 'opacity 220ms ease-out',
  }), [donationFlash, donationRed, reducedMotion]);

  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [animatedMessages.length]);

  return (
    <div style={containerStyle}>
      <div style={flashStyle} aria-hidden />
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          borderBottom: `3px solid ${textColor}`,
          paddingBottom: 6,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            fontFamily: headingFont,
            fontWeight: opts.fontWeight,
            fontSize: cqwCap(common.scale(32), 8, supportsCq),
            letterSpacing: -0.5,
            textTransform: 'uppercase',
            lineHeight: 1.3,
            padding: '0.1em 0.1em',
          }}
        >
          CHAT
          <span
            style={{
              color: accent,
              marginLeft: 6,
              fontFamily: headingFont,
              fontWeight: opts.fontWeight,
            }}
          >
            /
          </span>
          <span
            style={{
              fontSize: cqwCap(common.scale(16), 4, supportsCq),
              letterSpacing: 2,
              fontWeight: opts.artistFontWeight ?? '700',
              marginLeft: 6,
              opacity: 0.7,
            }}
          >
            LIVE
          </span>
        </div>
        <div
          style={{
            fontFamily: headingFont,
            fontSize: cqwCap(common.scale(14), 3.5, supportsCq),
            letterSpacing: 2,
            fontWeight: 700,
            opacity: 0.65,
          }}
        >
          #{animatedMessages.length.toString().padStart(2, '0')}
        </div>
      </div>

      {animatedMessages.length === 0 ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: headingFont,
            fontSize: cqwCap(common.scale(20), 5, supportsCq),
            letterSpacing: 3,
            textTransform: 'uppercase',
            opacity: 0.4,
          }}
        >
          WAITING FOR CHAT
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
                ? `billboard-chat-enter ${enterDuration}ms cubic-bezier(0.25,0.46,0.45,0.94) ${stagger * Math.min(index, 4)}ms 1 both`
                : phase === 'exiting' && !reducedMotion
                  ? `billboard-chat-exit ${exitDuration}ms ease-in 0ms 1 both`
                  : undefined;
            const amount = formatAmount(message);
            const rank = animatedMessages.length - index;

            return (
              <li
                key={message.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr',
                  gap: 10,
                  alignItems: 'baseline',
                  padding: isDonation ? '8px 10px' : 0,
                  borderLeft: isDonation ? `4px solid ${donationRed}` : 'none',
                  backgroundColor: isDonation
                    ? 'rgba(229, 39, 43, 0.08)'
                    : 'transparent',
                  animation: animationCss,
                }}
              >
                <div
                  style={{
                    fontFamily: headingFont,
                    fontWeight: opts.fontWeight,
                    fontSize: cqwCap(common.scale(20), 5, supportsCq),
                    letterSpacing: -0.5,
                    lineHeight: 1.3,
                    padding: '0.1em 0.1em',
                    color: isDonation ? donationRed : accent,
                    minWidth: fluidOr('32px', 'min(32px, 8cqw)', supportsCq),
                    textAlign: opts.textAlign === 'right' ? 'right' : 'left',
                  }}
                >
                  {rank.toString().padStart(2, '0')}
                </div>
                <div>
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
                        fontFamily: headingFont,
                        fontWeight: opts.fontWeight,
                        fontSize: cqwCap(common.scale(16), 4, supportsCq),
                        letterSpacing: -0.3,
                        textTransform: 'uppercase',
                        color: textColor,
                      }}
                    >
                      {message.nickname}
                    </span>
                    <span
                      style={{
                        fontFamily: headingFont,
                        fontSize: cqwCap(common.scale(9), 2.3, supportsCq),
                        fontWeight: 700,
                        letterSpacing: 1.5,
                        color: textColor,
                        opacity: 0.55,
                      }}
                    >
                      {platformLabel(message.platform)}
                    </span>
                    {amount && (
                      <span
                        style={{
                          marginLeft: 'auto',
                          fontFamily: headingFont,
                          fontSize: cqwCap(common.scale(14), 3.5, supportsCq),
                          fontWeight: opts.fontWeight,
                          color: donationRed,
                          letterSpacing: -0.2,
                        }}
                      >
                        🎁 {amount}
                      </span>
                    )}
                  </div>
                  <p
                    style={{
                      margin: '2px 0 0',
                      fontFamily: bodyFont,
                      fontWeight: opts.artistFontWeight ?? '500',
                      fontSize: cqwCap(common.scale(15), 3.8, supportsCq),
                      lineHeight: 1.4,
                      color: textColor,
                      opacity: 0.95,
                      wordBreak: 'break-word',
                    }}
                  >
                    <ChatMessageContent message={message.message} platform={message.platform} emotes={message.emotes} />
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <style>{`
        @keyframes billboard-chat-enter {
          from { opacity: 0; transform: translateX(-12px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes billboard-chat-exit {
          from { opacity: 1; transform: translateX(0); }
          to { opacity: 0; transform: translateX(-4px); }
        }
      `}</style>
    </div>
  );
}
Chatbox.displayName = 'Chatbox';
export default memo(Chatbox);
