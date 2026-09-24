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
import { defaultOptions, type GlassmorphismOptions } from './config';
import LiquidGlassFilter from './LiquidGlassFilter';

const LIQUID_FILTER_ID = 'liquid-glass-chatbox';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): GlassmorphismOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<GlassmorphismOptions>),
  };
}

const PLATFORM_LABEL: Record<string, string> = {
  chzzk: 'CHZZK',
  soop: 'SOOP',
  cime: 'CIME',
  meloming: 'MELOMING',
};

const MAX_VISIBLE = 8;

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function isDonationEvent(event: OverlayChatEvent): boolean {
  return event.type === 'donation';
}

function platformLabel(platform: string): string {
  return PLATFORM_LABEL[platform] ?? platform.toUpperCase();
}

/** Deterministic hue picker for nicknames — keeps the same user at the same color. */
function nicknameColor(nickname: string, textColor: string): string {
  if (!nickname) return textColor;
  let hash = 0;
  for (let i = 0; i < nickname.length; i++) {
    hash = (hash * 31 + nickname.charCodeAt(i)) & 0xffffffff;
  }
  const hue = Math.abs(hash) % 360;
  // Soft pastel against dark/light — high lightness, low saturation so it reads on glass.
  return `hsl(${hue}, 70%, 82%)`;
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
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.heading ?? ['Inter', 'sans-serif']),
    [common.fontFamily, fonts.roles.heading],
  );
  const bodyFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['Pretendard', 'sans-serif']),
    [common.fontFamily, fonts.roles.body],
  );
  const accentFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.accent ?? ['Inter', 'monospace']),
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

  const { isPlaying: donationFlash, trigger: triggerDonation } = useDonationAnimation({
    animation: animations.donation,
    reducedMotion,
  });

  useEffect(() => {
    const hasDonation = animatedMessages.some(
      (m) => isDonationEvent(m.message) && m.phase === 'entering',
    );
    if (hasDonation) {
      triggerDonation();
    }
  }, [animatedMessages, triggerDonation]);

  const cardOpacity = clamp(options.cardOpacity, 0, 100) / 100;
  const textColor = common.textColor ?? options.textColor ?? '#ffffff';
  const accentColor = common.accentColor ?? textColor;
  const gradientStart = options.gradientStart || '#667eea';
  const gradientEnd = options.gradientEnd || '#764ba2';

  const glassOpacity = clamp(options.glassOpacity ?? 0.28, 0.1, 0.6);
  const glassBlur = clamp(options.glassBlur ?? 20, 8, 40);

  // Common transparency controls
  const blurPx = common.blurIntensity;
  const borderOpacity = common.borderOpacity;

  // Inner bubbles use a flat background only — outer card already has the
  // backdrop-filter blur, and stacking another blur per chat item is very
  // expensive (each blur creates a new compositing surface).
  const bubbleBg = `rgba(255, 255, 255, ${Math.max(cardOpacity * 0.9, 0.08)})`;
  const bubbleBorder = `rgba(255, 255, 255, ${Math.max(borderOpacity * 0.9, 0.14)})`;

  const enterDuration = animations['chat.enter']?.enterDuration ?? 350;
  const stagger = animations['chat.enter']?.stagger ?? 60;
  const exitDuration = animations['chat.exit']?.enterDuration ?? 200;
  const enterEasing = animations['chat.enter']?.easing ?? 'cubic-bezier(0.22, 1, 0.36, 1)';
  const exitEasing = animations['chat.exit']?.easing ?? 'ease-out';
  const donationDuration = animations.donation?.enterDuration ?? 800;

  const containerStyle: React.CSSProperties = useMemo(() => ({
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: bodyFont,
    fontWeight: common.fontWeight,
    color: textColor,
    background: 'transparent',
    position: 'relative',
    overflow: 'hidden',
  }), [bodyFont, common.textSizeMultiplier, common.fontWeight, textColor]);

  const frameStyle: React.CSSProperties = useMemo(() => {
    const effectiveGlassOpacity = glassOpacity * common.backgroundOpacity;
    const liquidFilter = `url(#${LIQUID_FILTER_ID}) blur(${glassBlur}px) saturate(180%)`;
    const fallbackFilter = `blur(${blurPx}px) saturate(180%)`;
    const topRim = donationFlash
      ? `inset 0 1.5px 0 rgba(255, 255, 255, ${0.92 * common.backgroundOpacity})`
      : `inset 0 1.5px 0 rgba(255, 255, 255, ${0.72 * common.backgroundOpacity})`;
    return {
      position: 'relative',
      flex: 1,
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      padding: 16,
      borderRadius: 24,
      backgroundColor: `rgba(18, 18, 24, ${effectiveGlassOpacity})`,
      backdropFilter: liquidFilter,
      WebkitBackdropFilter: fallbackFilter,
      border: `1.5px solid rgba(255, 255, 255, ${0.32 * borderOpacity})`,
      boxShadow: [
        topRim,
        `inset 0 -1px 0 rgba(0, 0, 0, ${0.22 * common.backgroundOpacity})`,
        `inset 1.5px 0 0 rgba(255, 255, 255, ${0.22 * common.backgroundOpacity})`,
        `inset -1.5px 0 0 rgba(255, 255, 255, ${0.22 * common.backgroundOpacity})`,
      ].join(', '),
      overflow: 'hidden',
    };
  }, [glassBlur, glassOpacity, blurPx, borderOpacity, common.backgroundOpacity, donationFlash]);

  const specularStyle: React.CSSProperties = useMemo(() => ({
    position: 'absolute',
    inset: 0,
    borderRadius: 24,
    pointerEvents: 'none',
    zIndex: 0,
    background: [
      'radial-gradient(ellipse 75% 50% at 18% 6%, rgba(255,255,255,0.58) 0%, rgba(255,255,255,0.22) 26%, rgba(255,255,255,0) 58%)',
      'radial-gradient(ellipse 50% 32% at 88% 92%, rgba(255,255,255,0.26) 0%, rgba(255,255,255,0) 64%)',
      'linear-gradient(135deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 38%, rgba(255,255,255,0) 68%, rgba(255,255,255,0.12) 100%)',
    ].join(', '),
    mixBlendMode: 'overlay',
  }), []);

  const contentLayerStyle: React.CSSProperties = useMemo(() => ({
    position: 'relative',
    zIndex: 1,
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
  }), []);

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

  const headerStyle: React.CSSProperties = useMemo(() => ({
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  }), []);

  const hasMessages = animatedMessages.length > 0;

  return (
    <div style={containerStyle}>
      <LiquidGlassFilter id={LIQUID_FILTER_ID} />
      <div style={frameStyle}>
        <div aria-hidden style={specularStyle} />
        <div style={contentLayerStyle}>
        <div style={headerStyle}>
          <div
            style={{
              fontFamily: headingFont,
              fontSize: common.scale(16),
              fontWeight: 700,
              color: textColor,
              letterSpacing: 0.5,
            }}
          >
            Chat
          </div>
          {statusMeta && (
            <span
              style={{
                marginLeft: 'auto',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontFamily: accentFont,
                fontSize: common.scale(11),
                letterSpacing: 1,
                padding: '3px 8px',
                borderRadius: 999,
                backgroundColor: 'rgba(255, 255, 255, 0.12)',
                border: `1px solid rgba(255, 255, 255, 0.22)`,
                color: textColor,
                textTransform: 'uppercase',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  backgroundColor: statusMeta.color,
                  boxShadow: `0 0 8px ${statusMeta.color}`,
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
              color: textColor,
              opacity: 0.6,
              border: `1px dashed rgba(255, 255, 255, ${Math.max(borderOpacity * 0.7, 0.12)})`,
              borderRadius: 16,
              backgroundColor: 'rgba(255, 255, 255, 0.04)',
              animation: reducedMotion
                ? undefined
                : 'glassmorphism-glass-shimmer 2.4s ease-in-out infinite',
            }}
          >
            Waiting for chat...
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
                  ? `glassmorphism-glass-slide-in ${enterDuration}ms ${enterEasing} ${stagger * index}ms 1 both`
                  : phase === 'exiting' && !reducedMotion
                    ? `glassmorphism-glass-fade-out ${exitDuration}ms ${exitEasing} 0ms 1 both`
                    : undefined;

              const bubbleBackground = isDonation
                ? `rgba(255, 255, 255, ${Math.min(cardOpacity * 1.6 + 0.08, 0.38)})`
                : bubbleBg;
              const bubbleBorderColor = isDonation
                ? `rgba(255, 255, 255, ${Math.min(borderOpacity * 2, 0.55)})`
                : bubbleBorder;

              return (
                <li
                  key={message.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                    padding: isDonation ? '10px 12px' : '8px 11px',
                    borderRadius: 14,
                    backgroundColor: bubbleBackground,
                    border: `1px solid ${bubbleBorderColor}`,
                    boxShadow: isDonation
                      ? '0 4px 24px rgba(255, 255, 255, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.32)'
                      : '0 2px 10px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.18)',
                    animation: animationCss,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontFamily: accentFont,
                      fontSize: common.scale(12),
                    }}
                  >
                    <span
                      style={{
                        fontSize: common.scale(10),
                        letterSpacing: 1,
                        padding: '2px 6px',
                        borderRadius: 999,
                        backgroundColor: 'rgba(255, 255, 255, 0.18)',
                        border: `1px solid rgba(255, 255, 255, 0.28)`,
                        color: textColor,
                        textTransform: 'uppercase',
                      }}
                    >
                      {platformLabel(message.platform)}
                    </span>
                    <span
                      style={{
                        fontFamily: headingFont,
                        fontSize: common.scale(16),
                        fontWeight: 600,
                        color: nicknameColor(message.nickname, textColor),
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
                          letterSpacing: 1,
                          padding: '2px 6px',
                          borderRadius: 999,
                          backgroundColor: 'rgba(255, 255, 255, 0.28)',
                          border: `1px solid rgba(255, 255, 255, 0.42)`,
                          color: textColor,
                          textTransform: 'uppercase',
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
                      opacity: isDonation ? 1 : 0.92,
                      wordBreak: 'break-word',
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
    </div>
  );
}
Chatbox.displayName = 'Chatbox';
export default memo(Chatbox);
