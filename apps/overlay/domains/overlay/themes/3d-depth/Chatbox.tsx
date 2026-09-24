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
import { buildBlurFilter } from '../shared/apply-transparency';
import { defaultOptions, type ThreeDDepthOptions } from './config';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): ThreeDDepthOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<ThreeDDepthOptions>),
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

function hexToRgbTriplet(hex: string, fallback = '30, 41, 59'): string {
  const match = hex.trim().match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!match) return fallback;
  const r = parseInt(match[1], 16);
  const g = parseInt(match[2], 16);
  const b = parseInt(match[3], 16);
  return `${r}, ${g}, ${b}`;
}

function lighten(rgbTriplet: string, amount: number): string {
  const [r, g, b] = rgbTriplet.split(',').map((p) => parseInt(p.trim(), 10));
  const lift = (v: number) => Math.round(v + (255 - v) * amount);
  return `${lift(r)}, ${lift(g)}, ${lift(b)}`;
}

/** Deterministic hue picker for nicknames. */
function nicknameColor(nickname: string, fallback: string): string {
  if (!nickname) return fallback;
  let hash = 0;
  for (let i = 0; i < nickname.length; i++) {
    hash = (hash * 31 + nickname.charCodeAt(i)) & 0xffffffff;
  }
  const hue = Math.abs(hash) % 360;
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
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['Poppins', 'sans-serif']),
    [common.fontFamily, fonts.roles.body],
  );
  const accentFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.accent ?? ['Outfit', 'sans-serif']),
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

  const perspective = clamp(options.perspective, 400, 1200);
  const rotateY = clamp(options.rotateY, -20, 20);
  const rotateX = clamp(options.rotateX, -20, 20);
  const shadowDepth = clamp(options.shadowDepth, 8, 40);

  const baseColor = options.baseColor || '#1e293b';
  const accentColor = common.accentColor ?? options.accentColor ?? '#6366f1';
  const highlightColor = options.highlightColor || '#a78bfa';
  const textColor = common.textColor ?? options.textColor ?? '#ffffff';

  const baseRgb = hexToRgbTriplet(baseColor, '30, 41, 59');
  const accentRgb = hexToRgbTriplet(accentColor, '99, 102, 241');
  const baseLighter = lighten(baseRgb, 0.14);

  const shadowScale = shadowDepth / 20;
  const cardShadow = [
    `${Math.round(25 * shadowScale)}px ${Math.round(25 * shadowScale)}px ${Math.round(60 * shadowScale)}px rgba(0, 0, 0, 0.5)`,
    `-${Math.round(4 * shadowScale)}px -${Math.round(4 * shadowScale)}px ${Math.round(15 * shadowScale)}px rgba(255, 255, 255, 0.02)`,
    `0 0 ${Math.round(30 * shadowScale)}px rgba(${accentRgb}, 0.08)`,
  ].join(', ');

  const donationCardShadow = [
    `${Math.round(35 * shadowScale)}px ${Math.round(40 * shadowScale)}px ${Math.round(90 * shadowScale)}px rgba(0, 0, 0, 0.65)`,
    `0 0 ${Math.round(60 * shadowScale)}px rgba(${accentRgb}, 0.45)`,
    `-${Math.round(6 * shadowScale)}px -${Math.round(6 * shadowScale)}px ${Math.round(20 * shadowScale)}px rgba(255, 255, 255, 0.06)`,
  ].join(', ');

  const enterDuration = animations['chat.enter']?.enterDuration ?? 450;
  const stagger = animations['chat.enter']?.stagger ?? 60;
  const exitDuration = animations['chat.exit']?.enterDuration ?? 300;
  const enterEasing = animations['chat.enter']?.easing ?? 'cubic-bezier(0.22, 1, 0.36, 1)';
  const exitEasing = animations['chat.exit']?.easing ?? 'ease-in';
  const donationDuration = animations.donation?.enterDuration ?? 1000;

  const containerStyle: React.CSSProperties = useMemo(() => ({
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: bodyFont,
    fontWeight: common.fontWeight,
    color: textColor,
    background: 'transparent',
    perspective: `${perspective}px`,
    perspectiveOrigin: '50% 40%',
    position: 'relative',
    overflow: 'visible',
    padding: 16,
  }), [bodyFont, common.textSizeMultiplier, common.fontWeight, textColor, perspective]);

  const frameStyle: React.CSSProperties = useMemo(() => {
    const rgb = hexToRgbTriplet(baseColor, '30, 41, 59');
    const lighter = lighten(rgb, 0.14);
    return {
      position: 'relative',
      flex: 1,
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      padding: '18px 20px',
      borderRadius: 20,
      background: `linear-gradient(135deg, rgba(${lighter}, ${common.backgroundOpacity}) 0%, rgba(${rgb}, ${common.backgroundOpacity}) 100%)`,
      border: `1px solid rgba(255, 255, 255, ${0.05 * common.borderOpacity})`,
      transform: `rotateY(${rotateY}deg) rotateX(${rotateX}deg)`,
      transformStyle: 'preserve-3d',
      transformOrigin: 'center center',
      willChange: 'transform',
      backdropFilter: buildBlurFilter(common.blurIntensity),
      WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
    };
  }, [baseColor, rotateY, rotateX, common.backgroundOpacity, common.borderOpacity, common.blurIntensity]);

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
    marginBottom: 13,
  }), []);

  const hasMessages = animatedMessages.length > 0;

  return (
    <div style={containerStyle}>
      <div style={frameStyle}>
        <div style={headerStyle}>
          <div
            style={{
              fontFamily: headingFont,
              fontSize: common.scale(16),
              fontWeight: 700,
              color: textColor,
              letterSpacing: 0.5,
              textShadow: '0 2px 6px rgba(0, 0, 0, 0.4)',
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
                padding: '3px 9px',
                borderRadius: 999,
                background: 'rgba(0, 0, 0, 0.35)',
                border: `1px solid rgba(255, 255, 255, 0.1)`,
                color: textColor,
                textTransform: 'uppercase',
                boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.4)',
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
              padding: '32px 12px',
              textAlign: 'center',
              fontFamily: bodyFont,
              fontSize: common.scale(13),
              color: textColor,
              opacity: 0.55,
              border: `1px dashed rgba(255, 255, 255, 0.1)`,
              borderRadius: 14,
              backgroundColor: 'rgba(0, 0, 0, 0.18)',
              boxShadow: 'inset 0 2px 8px rgba(0, 0, 0, 0.3)',
              animation: reducedMotion
                ? undefined
                : 'depth3d-float 4s ease-in-out infinite',
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
              gap: 9,
              justifyContent: 'flex-end',
              overflow: 'hidden auto',
            }}
          >
            {animatedMessages.map(({ message, phase, index }) => {
              const isDonation = isDonationEvent(message);

              // Enter animation: depth-slide for chat, card-jump for donation.
              // Exit animation: recede (fall into depth).
              const animationCss = (() => {
                if (reducedMotion) return undefined;
                if (phase === 'entering') {
                  if (isDonation) {
                    return `depth3d-card-jump ${donationDuration}ms cubic-bezier(0.34, 1.56, 0.64, 1) ${stagger * index}ms 1 both`;
                  }
                  return `depth3d-depth-slide ${enterDuration}ms ${enterEasing} ${stagger * index}ms 1 both`;
                }
                if (phase === 'exiting') {
                  return `depth3d-recede ${exitDuration}ms ${exitEasing} 0ms 1 both`;
                }
                return undefined;
              })();

              const bubbleBackground = isDonation
                ? `linear-gradient(135deg, rgba(${accentRgb}, 0.42) 0%, rgba(${accentRgb}, 0.2) 100%)`
                : `linear-gradient(135deg, rgba(${baseLighter}, 0.55) 0%, rgba(${baseRgb}, 0.55) 100%)`;
              const bubbleBorderColor = isDonation
                ? `rgba(${accentRgb}, 0.55)`
                : 'rgba(255, 255, 255, 0.06)';
              const bubbleShadow = isDonation
                ? `10px 14px 28px rgba(0, 0, 0, 0.5), 0 0 30px rgba(${accentRgb}, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.12)`
                : `6px 8px 18px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.04)`;

              return (
                <li
                  key={message.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    padding: isDonation ? '12px 14px' : '9px 12px',
                    borderRadius: 13,
                    background: bubbleBackground,
                    border: `1px solid ${bubbleBorderColor}`,
                    boxShadow: bubbleShadow,
                    transformOrigin: 'center center',
                    animation: animationCss,
                    willChange: 'transform',
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
                        padding: '2px 7px',
                        borderRadius: 999,
                        background: `linear-gradient(135deg, rgba(${accentRgb}, 0.35), rgba(${accentRgb}, 0.18))`,
                        border: `1px solid rgba(${accentRgb}, 0.45)`,
                        color: highlightColor,
                        textTransform: 'uppercase',
                      }}
                    >
                      {platformLabel(message.platform)}
                    </span>
                    <span
                      style={{
                        fontFamily: headingFont,
                        fontSize: common.scale(16),
                        fontWeight: 700,
                        color: nicknameColor(message.nickname, textColor),
                        letterSpacing: 0.2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: 200,
                        textShadow: '0 1px 3px rgba(0, 0, 0, 0.5)',
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
                          padding: '2px 7px',
                          borderRadius: 999,
                          background: `linear-gradient(135deg, ${accentColor}, ${highlightColor})`,
                          color: '#ffffff',
                          textTransform: 'uppercase',
                          boxShadow: `0 3px 12px rgba(${accentRgb}, 0.5)`,
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
                      textShadow: '0 1px 3px rgba(0, 0, 0, 0.35)',
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
