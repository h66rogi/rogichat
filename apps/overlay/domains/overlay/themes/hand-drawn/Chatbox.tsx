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
import { defaultOptions, type HandDrawnOptions } from './config';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): HandDrawnOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<HandDrawnOptions>),
  };
}

const PLATFORM_LABEL: Record<string, string> = {
  chzzk: 'Chzzk',
  soop: 'Soop',
  cime: 'Cime',
  meloming: 'Meloming',
};

const MAX_VISIBLE = 8;

function clampTilt(value: number): number {
  if (Number.isNaN(value)) return 2;
  return Math.max(0, Math.min(5, value));
}

function clampRoughness(value: number): number {
  if (Number.isNaN(value)) return 2;
  return Math.max(1, Math.min(4, value));
}

function isDonationEvent(event: OverlayChatEvent): boolean {
  return event.type === 'donation';
}

function platformLabel(platform: string): string {
  return PLATFORM_LABEL[platform] ?? platform;
}

function bubbleTilt(seed: string, index: number, tiltMax: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const norm = ((hash >>> 0) % 1000) / 1000;
  const sign = index % 2 === 0 ? -1 : 1;
  // Bubbles tilt more subtly than queue stickers (max ~1.5°)
  const max = Math.min(tiltMax, 1.5);
  const magnitude = 0.2 + norm * Math.max(0, max - 0.2);
  return parseFloat((sign * magnitude).toFixed(2));
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
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.heading ?? ['Caveat', 'cursive']),
    [common.fontFamily, fonts.roles.heading],
  );
  const bodyFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['Patrick Hand', 'sans-serif']),
    [common.fontFamily, fonts.roles.body],
  );

  // Clamp the incoming message list so the paper card doesn't grow unbounded.
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

  const paperColor = options.paperColor || '#faf5eb';
  const inkColor = common.textColor ?? options.inkColor ?? '#2c2c2c';
  const accentColor = common.accentColor ?? options.accentColor ?? '#ff6b6b';
  const highlightColor = options.highlightColor || '#ffeb3b';
  const tiltMax = clampTilt(options.tiltMax);
  const roughness = clampRoughness(options.borderRoughness);
  const showTape = options.showTape !== false;

  const enterDuration = animations['chat.enter']?.enterDuration ?? 400;
  const stagger = animations['chat.enter']?.stagger ?? 60;
  const exitDuration = animations['chat.exit']?.enterDuration ?? 300;
  const donationDuration = animations.donation?.enterDuration ?? 800;

  const containerStyle: React.CSSProperties = useMemo(() => ({
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: bodyFont,
    fontWeight: common.fontWeight,
    color: inkColor,
    background: 'transparent',
  }), [bodyFont, common.textSizeMultiplier, common.fontWeight, inkColor]);

  const cardStyle: React.CSSProperties = useMemo(() => ({
    position: 'relative',
    flex: 1,
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    padding: '24px 22px 20px 22px',
    backgroundColor: hexToRgba(paperColor, common.backgroundOpacity),
    // Subtle "lined paper" pattern.
    backgroundImage: `repeating-linear-gradient(
      to bottom,
      transparent 0px,
      transparent 22px,
      ${inkColor}10 22px,
      ${inkColor}10 23px
    )`,
    borderRadius: 6 + roughness,
    border: `${roughness}px solid ${withOpacity(inkColor, common.borderOpacity)}`,
    transform: 'rotate(0.6deg)',
    overflow: 'visible',
    backdropFilter: buildBlurFilter(common.blurIntensity),
    WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
  }), [inkColor, paperColor, roughness, common.backgroundOpacity, common.borderOpacity, common.blurIntensity]);

  const tapeStyle: React.CSSProperties = useMemo(() => ({
    position: 'absolute',
    top: -12,
    left: 28,
    width: 78,
    height: 22,
    background: `linear-gradient(180deg, ${highlightColor}cc, ${highlightColor}88)`,
    border: `1px solid ${inkColor}33`,
    transform: 'rotate(-7deg)',
    boxShadow: '0 2px 4px rgba(0,0,0,0.12)',
    pointerEvents: 'none',
  }), [highlightColor, inkColor]);

  const headerStyle: React.CSSProperties = useMemo(() => ({
    fontFamily: headingFont,
    fontSize: common.scale(24),
    fontWeight: 700,
    color: inkColor,
    marginBottom: 12,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 8,
    borderBottom: `${Math.max(1, roughness - 1)}px dashed ${inkColor}66`,
  }), [headingFont, inkColor, roughness, common.textSizeMultiplier]);

  // Connection status as a small handwritten label
  const statusMeta = (() => {
    switch (connectionStatus) {
      case 'connected':
        return { label: '연결됨', color: '#3fa14a' };
      case 'connecting':
        return { label: '연결 중...', color: '#c08a2e' };
      case 'reconnecting':
        return { label: '재연결 중...', color: '#c08a2e' };
      case 'disconnected':
        return { label: '연결 끊김', color: '#c0392b' };
      default:
        return null;
    }
  })();

  const hasMessages = animatedMessages.length > 0;

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        {showTape && <div aria-hidden="true" style={tapeStyle} />}

        <div style={headerStyle}>
          <span aria-hidden="true">{'\u{1F4AC}'}</span>
          <span>채팅 노트</span>
          {statusMeta && (
            <span
              style={{
                marginLeft: 'auto',
                fontFamily: bodyFont,
                fontSize: common.scale(12),
                fontStyle: 'italic',
                fontWeight: 400,
                color: statusMeta.color,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  backgroundColor: statusMeta.color,
                  display: 'inline-block',
                }}
              />
              {statusMeta.label}
            </span>
          )}
        </div>

        {!hasMessages ? (
          <div
            style={{
              padding: '28px 14px',
              textAlign: 'center',
              fontFamily: headingFont,
              fontSize: common.scale(18),
              color: inkColor,
              opacity: 0.6,
              fontStyle: 'italic',
              border: `${Math.max(1, roughness - 1)}px dashed ${inkColor}55`,
            }}
          >
            {'\u270F\uFE0F'} 메시지 기다리는 중...
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
              gap: 12,
              justifyContent: 'flex-end',
              overflow: 'hidden auto',
              minHeight: 0,
            }}
          >
            {animatedMessages.map(({ message, phase, index }) => {
              const isDonation = isDonationEvent(message);
              const tiltDeg = bubbleTilt(message.id, index, tiltMax);

              const animationCss =
                phase === 'entering' && !reducedMotion
                  ? `hand-drawn-pencil-draw ${enterDuration}ms ease-out ${stagger * index}ms 1 both`
                  : phase === 'exiting' && !reducedMotion
                    ? `hand-drawn-eraser-fade ${exitDuration}ms ease-in 0ms 1 both`
                    : undefined;

              // Donation messages get a highlight pulse layered on top of the
              // pencil-draw entry. The shadow flash on the card-level driven by
              // the donation hook handles the global pulse.
              const donationPulse =
                isDonation && phase === 'entering' && !reducedMotion
                  ? `, hand-drawn-highlight-stamp ${donationDuration}ms ease-in-out ${stagger * index + enterDuration}ms 1 both`
                  : '';

              return (
                <li
                  key={message.id}
                  style={{
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    padding: isDonation ? '12px 14px' : '10px 14px',
                    backgroundColor: isDonation
                      ? `${highlightColor}aa`
                      : `${paperColor}`,
                    border: `${roughness}px solid ${isDonation ? accentColor : inkColor}`,
                    borderRadius: 14,
                    boxShadow: '0 3px 8px rgba(0,0,0,0.10)',
                    transform: `rotate(${tiltDeg}deg)`,
                    transformOrigin: 'left center',
                    animation: animationCss
                      ? `${animationCss}${donationPulse}`
                      : donationPulse
                        ? donationPulse.slice(2)
                        : undefined,
                  }}
                >
                  {/* Speech bubble tail (small triangle on the bottom-left) */}
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      left: 18,
                      bottom: -8,
                      width: 0,
                      height: 0,
                      borderLeft: '8px solid transparent',
                      borderRight: '8px solid transparent',
                      borderTop: `8px solid ${
                        isDonation ? accentColor : inkColor
                      }`,
                    }}
                  />
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      left: 19,
                      bottom: -6,
                      width: 0,
                      height: 0,
                      borderLeft: '7px solid transparent',
                      borderRight: '7px solid transparent',
                      borderTop: `7px solid ${
                        isDonation ? `${highlightColor}aa` : paperColor
                      }`,
                    }}
                  />

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: headingFont,
                        fontSize: common.scale(21),
                        fontWeight: 700,
                        color: accentColor,
                        letterSpacing: 0.2,
                      }}
                    >
                      {message.nickname}
                    </span>
                    <span
                      style={{
                        fontFamily: bodyFont,
                        fontSize: common.scale(13),
                        fontStyle: 'italic',
                        color: inkColor,
                        opacity: 0.5,
                      }}
                    >
                      {platformLabel(message.platform)}
                    </span>
                    {isDonation && (
                      <span
                        aria-hidden="true"
                        style={{
                          fontFamily: headingFont,
                          fontSize: common.scale(14),
                          color: accentColor,
                          fontWeight: 700,
                        }}
                      >
                        {'\u2605'} 후원
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontFamily: bodyFont,
                      fontSize: common.scale(isDonation ? 21 : 19),
                      fontWeight: 400,
                      color: inkColor,
                      lineHeight: 1.35,
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
  );
}
Chatbox.displayName = 'Chatbox';
export default memo(Chatbox);
