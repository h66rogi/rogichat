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
import { defaultOptions, type VinylAnalogOptions } from './config';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): VinylAnalogOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<VinylAnalogOptions>),
  };
}

const MAX_VISIBLE = 8;

const PLATFORM_LABEL: Record<string, string> = {
  chzzk: 'Chzzk',
  soop: 'Soop',
  cime: 'Cime',
  meloming: 'Meloming',
};

function isDonationEvent(event: OverlayChatEvent): boolean {
  return event.type === 'donation';
}

function platformLabel(platform: string): string {
  return PLATFORM_LABEL[platform] ?? platform;
}

const STATUS_LABEL: Record<string, string> = {
  connected: 'on the air',
  connecting: 'tuning in',
  reconnecting: 'tuning in',
  disconnected: 'off the air',
};

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
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.heading ?? ['Playfair Display', 'serif']),
    [common.fontFamily, fonts.roles.heading],
  );
  const bodyFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['Lora', 'serif']),
    [common.fontFamily, fonts.roles.body],
  );
  const accentFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.accent ?? ['Lora', 'serif']),
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

  const { isPlaying: donationGlow, trigger: triggerDonation } = useDonationAnimation({
    animation: animations.donation,
    reducedMotion,
  });

  // Trigger gold-glow pulse when a donation arrives.
  useEffect(() => {
    const hasDonation = animatedMessages.some(
      (m) => isDonationEvent(m.message) && m.phase === 'entering',
    );
    if (hasDonation) {
      triggerDonation();
    }
  }, [animatedMessages, triggerDonation]);

  const accentColor = common.accentColor ?? options.accentColor ?? defaultOptions.accentColor;
  const bgColor = options.backgroundColor || defaultOptions.backgroundColor;
  const textColor = common.textColor ?? options.textColor ?? defaultOptions.textColor;
  const labelColor = options.labelColor || defaultOptions.labelColor;

  const enterDuration = animations['chat.enter']?.enterDuration ?? 400;
  const stagger = animations['chat.enter']?.stagger ?? 60;
  const exitDuration = animations['chat.exit']?.enterDuration ?? 200;
  const donationDuration = animations.donation?.enterDuration ?? 900;

  const containerStyle: React.CSSProperties = useMemo(() => ({
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: bodyFont,
    fontWeight: common.fontWeight,
    color: textColor,
    background: 'transparent',
    boxSizing: 'border-box',
  }), [bodyFont, common.textSizeMultiplier, common.fontWeight, textColor]);

  const frameStyle: React.CSSProperties = useMemo(() => ({
    flex: 1,
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: hexToRgba(bgColor, common.backgroundOpacity),
    backgroundImage: [
      `radial-gradient(ellipse at 30% 20%, rgba(255, 220, 180, 0.08), transparent 55%)`,
      `repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.05) 0px, rgba(0, 0, 0, 0.05) 1px, transparent 1px, transparent 5px)`,
    ].join(', '),
    border: `1px solid ${withOpacity(accentColor, common.borderOpacity * 0.25)}`,
    borderRadius: 12,
    padding: '20px 22px',
    position: 'relative',
    boxShadow: [
      'inset 0 1px 0 rgba(255, 230, 190, 0.08)',
      'inset 0 0 40px rgba(0, 0, 0, 0.45)',
    ].join(', '),
    overflow: 'hidden',
    boxSizing: 'border-box',
    backdropFilter: buildBlurFilter(common.blurIntensity),
    WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
  }), [accentColor, bgColor, common.backgroundOpacity, common.borderOpacity, common.blurIntensity]);

  const headerStyle: React.CSSProperties = useMemo(() => ({
    fontFamily: accentFont,
    fontSize: common.scale(13),
    fontStyle: 'italic',
    letterSpacing: 3,
    textTransform: 'uppercase',
    color: accentColor,
    marginBottom: 12,
    paddingBottom: 8,
    borderBottom: `1px solid ${accentColor}33`,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  }), [accentColor, accentFont, common.textSizeMultiplier]);

  const statusKey = connectionStatus ?? 'disconnected';
  const statusLabel = STATUS_LABEL[statusKey] ?? STATUS_LABEL.disconnected;
  const statusColor = statusKey === 'connected' ? accentColor : `${textColor}66`;

  const hasMessages = animatedMessages.length > 0;

  return (
    <div style={containerStyle}>
      <div style={frameStyle}>
        <div style={headerStyle}>
          <span aria-hidden="true">{'\u266B'}</span>
          <span>Studio Chatter</span>
          <span
            style={{
              marginLeft: 'auto',
              fontFamily: bodyFont,
              fontSize: common.scale(12),
              letterSpacing: 1.5,
              fontStyle: 'italic',
              textTransform: 'lowercase',
              color: statusColor,
            }}
          >
            {statusLabel}
          </span>
        </div>

        {!hasMessages ? (
          <div
            style={{
              fontFamily: bodyFont,
              fontStyle: 'italic',
              fontSize: common.scale(13),
              color: textColor,
              opacity: 0.55,
              padding: '20px 4px',
              textAlign: 'center',
            }}
          >
            Studio is quiet...
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
                  ? `vinyl-analog-vintage-slide ${enterDuration}ms cubic-bezier(0.22, 1, 0.36, 1) ${
                      stagger * index
                    }ms 1 both`
                  : phase === 'exiting' && !reducedMotion
                    ? `vinyl-analog-paper-fade ${exitDuration}ms ease-out 0ms 1 both`
                    : undefined;

              // Donation cards get a pulsing gold glow via the donation animation.
              const glowCss =
                isDonation && donationGlow && !reducedMotion
                  ? `vinyl-analog-gold-glow ${donationDuration}ms ease-in-out 1 both`
                  : undefined;

              const combinedAnimation =
                [enterCss, glowCss].filter(Boolean).join(', ') || undefined;

              return (
                <li
                  key={message.id}
                  style={{
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    padding: isDonation ? '12px 14px' : '10px 12px',
                    backgroundColor: isDonation
                      ? `${accentColor}1a`
                      : 'rgba(0, 0, 0, 0.22)',
                    border: `1px solid ${
                      isDonation ? `${accentColor}99` : `${accentColor}33`
                    }`,
                    borderRadius: 6,
                    boxShadow: isDonation
                      ? `0 0 0 1px ${accentColor}33, 0 0 18px rgba(212, 175, 55, 0.18)`
                      : 'inset 0 1px 0 rgba(255, 230, 190, 0.04)',
                    animation: combinedAnimation,
                  }}
                >
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
                        fontFamily: accentFont,
                        fontSize: common.scale(11),
                        fontStyle: 'italic',
                        color: accentColor,
                        border: `1px solid ${accentColor}66`,
                        padding: '1px 5px',
                        borderRadius: 2,
                        letterSpacing: 1,
                      }}
                    >
                      {platformLabel(message.platform)}
                    </span>
                    <span
                      style={{
                        fontFamily: headingFont,
                        fontSize: common.scale(isDonation ? 16 : 15),
                        fontWeight: 700,
                        color: textColor,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: 220,
                      }}
                    >
                      {message.nickname}
                    </span>
                    {isDonation && (
                      <span
                        style={{
                          fontFamily: accentFont,
                          fontSize: common.scale(12),
                          fontStyle: 'italic',
                          color: accentColor,
                          letterSpacing: 1,
                          textTransform: 'uppercase',
                        }}
                      >
                        &middot; gold request
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontFamily: bodyFont,
                      fontSize: common.scale(isDonation ? 17 : 16),
                      fontWeight: isDonation ? 700 : 400,
                      fontStyle: isDonation ? 'italic' : 'normal',
                      lineHeight: 1.45,
                      color: isDonation ? accentColor : textColor,
                      wordBreak: 'break-word',
                      opacity: isDonation ? 1 : 0.92,
                    }}
                  >
                    <ChatMessageContent message={message.message} platform={message.platform} emotes={message.emotes} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
Chatbox.displayName = 'Chatbox';
export default memo(Chatbox);
