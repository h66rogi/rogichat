'use client';

import { useEffect, useMemo, memo} from 'react';
import type { ThemeWidgetProps } from '../types';
import type { OverlayChatEvent } from '../../types/chat';
import { ChatMessageContent } from '../../components/shared/ChatMessageContent';
import {
  buildFontFamilyValue,
  useChatAnimation,
  useCommonOptions,
  useDonationAnimation,
} from '../shared';
import { hexToRgba, buildBlurFilter } from '../shared/apply-transparency';
import { defaultOptions, type KoreanTraditionalOptions } from './config';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): KoreanTraditionalOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<KoreanTraditionalOptions>),
  };
}

const MAX_VISIBLE = 8;

const PLATFORM_LABEL: Record<string, string> = {
  chzzk: 'Chzzk',
  soop: 'Soop',
  cime: 'Cime',
  meloming: 'Meloming',
};

const STATUS_LABEL: Record<string, string> = {
  connected: '연결됨',
  connecting: '연결 중',
  reconnecting: '재연결 중',
  disconnected: '연결 끊김',
};

function isDonationEvent(event: OverlayChatEvent): boolean {
  return event.type === 'donation';
}

function platformLabel(platform: string): string {
  return PLATFORM_LABEL[platform] ?? platform;
}

function withAlpha(hex: string, alpha: number): string {
  if (!hex.startsWith('#') || hex.length !== 7) return hex;
  const a = Math.max(0, Math.min(255, Math.round(alpha))).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

function Chatbox({
  options: rawOptions,
  animations,
  fonts,
  reducedMotion,
  chatMessages,
  connectionStatus,
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
  const accentFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.accent ?? ['Black Han Sans', 'Noto Serif KR', 'sans-serif']),
    [common.fontFamily, fonts.roles.accent],
  );

  const visibleMessages = useMemo<OverlayChatEvent[]>(() => {
    const source = chatMessages ?? [];
    if (source.length <= MAX_VISIBLE) return source;
    return source.slice(-MAX_VISIBLE);
  }, [chatMessages]);

  const { animatedMessages } = useChatAnimation<OverlayChatEvent>({
    messages: visibleMessages,
    getMessageId: (msg) => msg.id,
    enterAnimation: animations['chat.enter'],
    exitAnimation: animations['chat.exit'],
    reducedMotion,
  });

  const { isPlaying: donationStamping, trigger: triggerDonation } = useDonationAnimation({
    animation: animations.donation,
    reducedMotion,
  });

  // Trigger the stamp-press animation whenever a donation message arrives.
  useEffect(() => {
    const hasDonation = animatedMessages.some(
      (m) => isDonationEvent(m.message) && m.phase === 'entering',
    );
    if (hasDonation) {
      triggerDonation();
    }
  }, [animatedMessages, triggerDonation]);

  const baseColor = options.baseColor || defaultOptions.baseColor;
  const inkColor = common.textColor ?? options.inkColor ?? defaultOptions.inkColor;
  const accentRed = common.accentColor ?? options.accentRed ?? defaultOptions.accentRed;
  const accentBrown = options.accentBrown || defaultOptions.accentBrown;
  const showStamp = options.showStamp ?? defaultOptions.showStamp;
  const stampText = (options.stampText ?? defaultOptions.stampText).slice(0, 4);

  const enterDuration = animations['chat.enter']?.enterDuration ?? 500;
  const stagger = animations['chat.enter']?.stagger ?? 80;
  const exitDuration = animations['chat.exit']?.enterDuration ?? 300;
  const donationDuration = animations.donation?.enterDuration ?? 900;

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
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: hexToRgba(baseColor, common.backgroundOpacity),
    backgroundImage: [
      `radial-gradient(ellipse at 20% 15%, rgba(255, 255, 255, ${0.45 * common.backgroundOpacity}), transparent 55%)`,
      `radial-gradient(ellipse at 80% 85%, ${hexToRgba(accentBrown, (22 / 255) * common.backgroundOpacity)}, transparent 60%)`,
      `repeating-radial-gradient(circle at 30% 40%, ${hexToRgba(inkColor, (8 / 255) * common.backgroundOpacity)} 0, ${hexToRgba(inkColor, (8 / 255) * common.backgroundOpacity)} 1px, transparent 1px, transparent 6px)`,
    ].join(', '),
    padding: 24,
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
    padding: '18px 14px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    minHeight: 0,
  }), []);

  const headerStyle: React.CSSProperties = useMemo(() => ({
    fontFamily: bodyFont,
    fontSize: common.scale(13),
    letterSpacing: 4,
    color: accentBrown,
    paddingBottom: 10,
    borderBottom: `1px solid ${withAlpha(accentBrown, 80)}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  }), [accentBrown, bodyFont, common.textSizeMultiplier]);

  const statusKey = connectionStatus ?? 'disconnected';
  const statusLabel = STATUS_LABEL[statusKey] ?? STATUS_LABEL.disconnected;
  const statusColor = statusKey === 'connected' ? accentBrown : `${accentBrown}88`;

  const hasMessages = animatedMessages.length > 0;

  return (
    <div style={containerStyle}>
      <div style={paperStyle}>
        <div style={innerBorderStyle} aria-hidden="true" />
        <div style={innerContentStyle}>
          <div style={headerStyle}>
            <span>대 화</span>
            <span
              style={{
                fontFamily: bodyFont,
                fontSize: common.scale(12),
                letterSpacing: 1.5,
                color: statusColor,
              }}
            >
              {statusLabel}
            </span>
          </div>

          {!hasMessages ? (
            <div
              style={{
                fontFamily: headingFont,
                fontSize: common.scale(14),
                fontStyle: 'italic',
                color: accentBrown,
                opacity: 0.7,
                padding: '24px 4px',
                textAlign: 'center',
              }}
            >
              고요
            </div>
          ) : (
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                justifyContent: 'flex-end',
                overflow: 'hidden auto',
              }}
            >
              {animatedMessages.map(({ message, phase, index }) => {
                const isDonation = isDonationEvent(message);

                const enterCss =
                  phase === 'entering' && !reducedMotion
                    ? isDonation
                      ? `korean-traditional-stamp-press ${donationDuration}ms ease-out 0ms 1 both`
                      : `korean-traditional-scroll-unroll ${enterDuration}ms ease-out ${
                          stagger * index
                        }ms 1 both`
                    : phase === 'exiting' && !reducedMotion
                      ? `korean-traditional-scroll-roll ${exitDuration}ms ease-in 0ms 1 both`
                      : undefined;

                // Donation cards are larger, sit on a tinted backdrop, and
                // wear a 도장 stamp anchored to the bottom-right corner.
                const cardStyle: React.CSSProperties = {
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  padding: isDonation ? '14px 16px 22px' : '10px 12px',
                  backgroundColor: isDonation
                    ? withAlpha(accentRed, 16)
                    : withAlpha(accentBrown, 8),
                  border: `1px solid ${
                    isDonation
                      ? withAlpha(accentRed, 140)
                      : withAlpha(accentBrown, 90)
                  }`,
                  borderRadius: 2,
                  boxShadow: isDonation
                    ? `inset 0 0 0 1px ${withAlpha(accentRed, 60)}, 0 4px 16px ${withAlpha(accentRed, 30)}`
                    : `inset 0 1px 0 rgba(255, 255, 255, 0.4)`,
                  animation: enterCss,
                  // While the donation animation is playing, give the card a
                  // subtle tilt highlight that emphasizes the stamp press.
                  transform:
                    isDonation && donationStamping && !reducedMotion
                      ? 'rotate(-0.5deg)'
                      : undefined,
                  transition: 'transform 200ms ease-out',
                };

                return (
                  <li key={message.id} style={cardStyle}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <span
                        style={{
                          fontFamily: bodyFont,
                          fontSize: common.scale(11),
                          color: accentBrown,
                          border: `1px solid ${withAlpha(accentBrown, 130)}`,
                          padding: '1px 5px',
                          borderRadius: 1,
                          letterSpacing: 1,
                        }}
                      >
                        {platformLabel(message.platform)}
                      </span>
                      <span
                        style={{
                          fontFamily: accentFont,
                          fontSize: common.scale(isDonation ? 18 : 16),
                          fontWeight: 700,
                          color: accentRed,
                          letterSpacing: 0.5,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: 240,
                        }}
                      >
                        {message.nickname}
                      </span>
                      {isDonation && (
                        <span
                          style={{
                            fontFamily: bodyFont,
                            fontSize: common.scale(10),
                            color: accentRed,
                            letterSpacing: 1,
                          }}
                        >
                          · 후 원
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontFamily: bodyFont,
                        fontSize: common.scale(isDonation ? 17 : 16),
                        fontWeight: isDonation ? 700 : 400,
                        lineHeight: 1.5,
                        color: inkColor,
                        wordBreak: 'break-word',
                      }}
                    >
                      <ChatMessageContent message={message.message} platform={message.platform} emotes={message.emotes} />
                    </div>
                    {isDonation && showStamp && stampText && (
                      <div
                        aria-hidden="true"
                        style={{
                          position: 'absolute',
                          right: 10,
                          bottom: 6,
                          transform: 'rotate(-4deg)',
                          border: `2px solid ${accentRed}`,
                          color: accentRed,
                          fontFamily: headingFont,
                          fontStyle: 'italic',
                          fontSize: common.scale(11),
                          fontWeight: 700,
                          letterSpacing: 1.5,
                          padding: '2px 7px',
                          opacity: 0.65,
                          backgroundColor: withAlpha(accentRed, 8),
                          borderRadius: 1,
                          pointerEvents: 'none',
                          userSelect: 'none',
                        }}
                      >
                        {stampText}
                      </div>
                    )}
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
Chatbox.displayName = 'Chatbox';
export default memo(Chatbox);
