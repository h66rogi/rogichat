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
import { hexToRgba, withOpacity, buildBlurFilter } from '../shared/apply-transparency';
import { defaultOptions, type KawaiiOptions } from './config';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): KawaiiOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<KawaiiOptions>),
  };
}

const PLATFORM_LABEL: Record<string, string> = {
  chzzk: 'CHZZK',
  soop: 'SOOP',
  cime: 'CIME',
  meloming: 'MELOMING',
};

const MAX_VISIBLE = 8;

function clampRadius(value: number): number {
  if (Number.isNaN(value)) return 20;
  return Math.max(8, Math.min(32, value));
}

function isDonationEvent(event: OverlayChatEvent): boolean {
  return event.type === 'donation';
}

function platformLabel(platform: string): string {
  return PLATFORM_LABEL[platform] ?? platform.toUpperCase();
}

function decorationGlyph(style: KawaiiOptions['decorationStyle']): string {
  switch (style) {
    case 'hearts':
      return '\u2665';
    case 'sparkles':
      return '\u2728';
    case 'stars':
    default:
      return '\u2605';
  }
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
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.heading ?? ['Fredoka', 'sans-serif']),
    [common.fontFamily, fonts.roles.heading],
  );
  const bodyFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['Comfortaa', 'sans-serif']),
    [common.fontFamily, fonts.roles.body],
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

  const { isPlaying: donationFlash, trigger: triggerDonation } = useDonationAnimation({
    animation: animations.donation,
    reducedMotion,
  });

  // Trigger donation animation on any entering donation event.
  useEffect(() => {
    const hasDonation = animatedMessages.some(
      (m) => isDonationEvent(m.message) && m.phase === 'entering',
    );
    if (hasDonation) {
      triggerDonation();
    }
  }, [animatedMessages, triggerDonation]);

  const mainColor = options.mainColor || '#ffb6d9';
  const accentColor = common.accentColor ?? options.accentColor ?? '#b088f9';
  const bgColor = options.backgroundColor || '#fff5fa';
  const textColor = common.textColor ?? options.textColor ?? '#d63384';
  const borderRadius = clampRadius(options.borderRadius);
  const deco = decorationGlyph(options.decorationStyle);

  const enterDuration = animations['chat.enter']?.enterDuration ?? 400;
  const stagger = animations['chat.enter']?.stagger ?? 50;
  const exitDuration = animations['chat.exit']?.enterDuration ?? 200;
  const donationDuration = animations.donation?.enterDuration ?? 1000;

  const softShadow = `0 8px 24px rgba(255, 182, 217, 0.35), 0 2px 8px rgba(176, 136, 249, 0.2)`;
  const donationShadow = `0 8px 40px rgba(255, 182, 217, 0.6), 0 0 60px rgba(176, 136, 249, 0.45)`;

  const containerStyle: React.CSSProperties = useMemo(() => ({
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: bodyFont,
    fontWeight: common.fontWeight,
    color: textColor,
    background: 'transparent',
  }), [bodyFont, common.textSizeMultiplier, common.fontWeight, textColor]);

  const cardStyle: React.CSSProperties = useMemo(() => ({
    position: 'relative',
    flex: 1,
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    padding: 16,
    borderRadius,
    backgroundColor: hexToRgba(bgColor, common.backgroundOpacity),
    border: `3px solid ${withOpacity(mainColor, common.borderOpacity)}`,
    overflow: 'hidden',
    backdropFilter: buildBlurFilter(common.blurIntensity),
    WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
  }), [bgColor, borderRadius, mainColor, common.backgroundOpacity, common.borderOpacity, common.blurIntensity]);

  const statusMeta = (() => {
    switch (connectionStatus) {
      case 'connected':
        return { label: 'Live', color: '#7dffb4' };
      case 'connecting':
        return { label: 'Connecting', color: '#ffd97a' };
      case 'reconnecting':
        return { label: 'Reconnecting', color: '#ffd97a' };
      case 'disconnected':
        return { label: 'Offline', color: '#ff8a8a' };
      default:
        return null;
    }
  })();

  const underlineStyle: React.CSSProperties = useMemo(() => ({
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 4,
    background: `linear-gradient(90deg, ${mainColor}, ${accentColor})`,
    borderBottomLeftRadius: borderRadius,
    borderBottomRightRadius: borderRadius,
  }), [accentColor, borderRadius, mainColor]);

  const headerStyle: React.CSSProperties = useMemo(() => ({
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  }), []);

  const hasMessages = animatedMessages.length > 0;

  const bubbleRadius = Math.max(6, borderRadius - 6);

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={headerStyle}>
          <span aria-hidden="true" style={{ fontSize: common.scale(14), color: accentColor }}>
            {deco}
          </span>
          <div
            style={{
              fontFamily: headingFont,
              fontSize: common.scale(17),
              fontWeight: 700,
              color: textColor,
              letterSpacing: 0.3,
            }}
          >
            Chat
          </div>
          <span aria-hidden="true" style={{ fontSize: common.scale(14), color: mainColor }}>
            {deco}
          </span>
          {statusMeta && (
            <span
              style={{
                marginLeft: 'auto',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontFamily: bodyFont,
                fontSize: common.scale(12),
                letterSpacing: 0.5,
                padding: '3px 10px',
                borderRadius: 999,
                backgroundColor: `${mainColor}22`,
                border: `1.5px solid ${mainColor}66`,
                color: accentColor,
                textTransform: 'uppercase',
                fontWeight: 700,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  backgroundColor: statusMeta.color,
                  boxShadow: `0 0 6px ${statusMeta.color}`,
                }}
              />
              {statusMeta.label}
            </span>
          )}
        </div>

        {!hasMessages ? (
          <div
            style={{
              padding: '28px 12px',
              textAlign: 'center',
              fontFamily: bodyFont,
              fontSize: common.scale(13),
              color: accentColor,
              border: `2px dashed ${mainColor}`,
              borderRadius: bubbleRadius,
              backgroundColor: `${mainColor}11`,
            }}
          >
            <div style={{ fontFamily: headingFont, fontWeight: 700, color: textColor }}>
              Waiting for friends to chat {'\u2665'}
            </div>
            <div style={{ marginTop: 4, fontSize: common.scale(12) }}>
              Say hi in chat {deco}
            </div>
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
              gap: 8,
              justifyContent: 'flex-end',
              overflow: 'hidden auto',
            }}
          >
            {animatedMessages.map(({ message, phase, index }) => {
              const isDonation = isDonationEvent(message);
              const animationCss =
                phase === 'entering' && !reducedMotion
                  ? `kawaii-pop-bounce ${enterDuration}ms cubic-bezier(0.68, -0.55, 0.27, 1.55) ${stagger * index}ms 1 both`
                  : phase === 'exiting' && !reducedMotion
                    ? `kawaii-shrink-fade ${exitDuration}ms ease-out 0ms 1 both`
                    : undefined;

              // Donation messages get a full burst-star animation layered on
              // top of the pop-bounce entry. We drive the burst from the
              // triggerDonation hook via the card-level shadow flash and also
              // apply a per-message chroma pulse when the donation is newly
              // added so the whole message "sparkles" for one beat.
              const donationPulse =
                isDonation && phase === 'entering' && !reducedMotion
                  ? `, kawaii-star-burst ${donationDuration}ms ease-in-out ${stagger * index + enterDuration}ms 1 both`
                  : '';

              return (
                <li
                  key={message.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                    padding: isDonation ? '10px 12px' : '8px 11px',
                    borderRadius: bubbleRadius,
                    background: isDonation
                      ? `linear-gradient(135deg, ${mainColor}44, ${accentColor}44)`
                      : `${mainColor}14`,
                    border: `2px solid ${isDonation ? accentColor : mainColor}`,
                    boxShadow: isDonation
                      ? `0 4px 16px rgba(176, 136, 249, 0.35)`
                      : `0 2px 8px rgba(255, 182, 217, 0.2)`,
                    animation: animationCss
                      ? `${animationCss}${donationPulse}`
                      : donationPulse
                        ? donationPulse.slice(2)
                        : undefined,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontFamily: bodyFont,
                      fontSize: common.scale(12),
                    }}
                  >
                    <span aria-hidden="true" style={{ color: mainColor, fontSize: common.scale(11) }}>
                      {deco}
                    </span>
                    <span
                      style={{
                        fontSize: common.scale(10),
                        letterSpacing: 0.5,
                        padding: '2px 6px',
                        borderRadius: 999,
                        backgroundColor: `${mainColor}33`,
                        border: `1px solid ${mainColor}66`,
                        color: accentColor,
                        textTransform: 'uppercase',
                        fontWeight: 700,
                      }}
                    >
                      {platformLabel(message.platform)}
                    </span>
                    <span
                      style={{
                        fontFamily: headingFont,
                        fontSize: common.scale(16),
                        fontWeight: 700,
                        color: accentColor,
                        letterSpacing: 0.2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: 200,
                      }}
                    >
                      {message.nickname}
                    </span>
                    {isDonation && (
                      <span
                        aria-hidden="true"
                        style={{
                          marginLeft: 'auto',
                          fontSize: common.scale(11),
                          letterSpacing: 0.5,
                          padding: '2px 8px',
                          borderRadius: 999,
                          background: `linear-gradient(90deg, ${mainColor}, ${accentColor})`,
                          color: '#ffffff',
                          textTransform: 'uppercase',
                          fontWeight: 700,
                        }}
                      >
                        {'\u2605'} Donation
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontFamily: bodyFont,
                      fontSize: common.scale(17),
                      lineHeight: 1.45,
                      color: textColor,
                      wordBreak: 'break-word',
                      fontWeight: isDonation ? 700 : 400,
                    }}
                  >
                    <ChatMessageContent message={message.message} platform={message.platform} emotes={message.emotes} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div aria-hidden="true" style={underlineStyle} />
      </div>
    </div>
  );
}
Chatbox.displayName = 'Chatbox';
export default memo(Chatbox);
