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
import { defaultOptions, type BrutalistOptions } from './config';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): BrutalistOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<BrutalistOptions>),
  };
}

const PLATFORM_LABEL: Record<string, string> = {
  chzzk: 'CHZZK',
  soop: 'SOOP',
  cime: 'CIME',
  meloming: 'MELOMING',
};

// Same alternating tilt pool per-message so the feed looks hand-stamped.
const MESSAGE_TILTS = [-0.5, 0.75, -1, 0.5, -0.75, 1, -0.5, 0.75] as const;
const PLATFORM_TAG_TILTS = [-3, 2, -2.5, 3, -2, 2.5, -3, 2] as const;

const MAX_VISIBLE = 8;

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function isDonationEvent(event: OverlayChatEvent): boolean {
  return event.type === 'donation';
}

function platformLabel(platform: string): string {
  return PLATFORM_LABEL[platform] ?? platform.toUpperCase();
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
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['Inter', 'sans-serif']),
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

  // Trigger screen-flash on any entering donation event.
  useEffect(() => {
    const hasDonation = animatedMessages.some(
      (m) => isDonationEvent(m.message) && m.phase === 'entering',
    );
    if (hasDonation) {
      triggerDonation();
    }
  }, [animatedMessages, triggerDonation]);

  const borderWidth = clampNumber(options.borderWidth, 2, 8, 5);
  const shadowOffset = clampNumber(options.shadowOffset, 4, 16, 10);
  const tiltAngle = clampNumber(options.tiltAngle, -5, 5, -1);
  const accentColor = common.accentColor ?? options.accentColor ?? '#ffff00';
  const dangerColor = options.dangerColor || '#ff0000';
  const bgColor = options.backgroundColor || '#f5f5dc';

  const hardShadow = `${shadowOffset}px ${shadowOffset}px 0 #000`;
  const donationShadow = `${shadowOffset + 4}px ${shadowOffset + 4}px 0 #000`;
  const ink = common.textColor ?? '#000000';

  const enterDuration = animations['chat.enter']?.enterDuration ?? 250;
  const stagger = animations['chat.enter']?.stagger ?? 30;
  const exitDuration = animations['chat.exit']?.enterDuration ?? 100;
  const donationDuration = animations.donation?.enterDuration ?? 400;

  const containerStyle: React.CSSProperties = useMemo(() => ({
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: bodyFont,
    fontWeight: common.fontWeight,
    color: ink,
    background: 'transparent',
    padding: 16,
  }), [bodyFont, common.textSizeMultiplier, common.fontWeight, ink]);

  // Custom props for the flash animation so it snaps between bg and accent
  // without us hard-coding the values inside the keyframes. Using CSS vars via
  // style attribute keeps the CSS static and themeable.
  const frameStyle: React.CSSProperties = useMemo(() => ({
    position: 'relative',
    flex: 1,
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: hexToRgba(bgColor, common.backgroundOpacity),
    border: `${borderWidth}px solid ${withOpacity(ink, common.borderOpacity)}`,
    borderRadius: 0,
    padding: 16,
    transform: tiltAngle === 0 ? undefined : `rotate(${tiltAngle}deg)`,
    transformOrigin: 'center center',
    backdropFilter: buildBlurFilter(common.blurIntensity),
    WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
    ['--brutalist-flash-from' as never]: bgColor,
    ['--brutalist-flash-to' as never]: accentColor,
    animation:
      donationFlash && !reducedMotion
        ? `brutalist-screen-flash ${donationDuration}ms steps(1, end) 1 both`
        : undefined,
  }), [accentColor, bgColor, borderWidth, donationDuration, donationFlash, ink, reducedMotion, tiltAngle, common.backgroundOpacity, common.borderOpacity, common.blurIntensity]);

  // Status rendered as a loud thick rect.
  const statusMeta = (() => {
    switch (connectionStatus) {
      case 'connected':
        return { label: 'LIVE', bg: dangerColor, color: '#ffffff' };
      case 'connecting':
        return { label: 'SYNC', bg: accentColor, color: ink };
      case 'reconnecting':
        return { label: 'RETRY', bg: accentColor, color: ink };
      case 'disconnected':
        return { label: 'OFFLINE', bg: ink, color: accentColor };
      default:
        return null;
    }
  })();

  const hasMessages = animatedMessages.length > 0;

  return (
    <div style={containerStyle}>
      <div style={frameStyle}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            paddingBottom: 10,
            marginBottom: 14,
            borderBottom: `${borderWidth}px solid ${ink}`,
          }}
        >
          <span
            style={{
              fontFamily: headingFont,
              fontWeight: 900,
              fontSize: common.scale(24),
              letterSpacing: -0.5,
              textTransform: 'uppercase',
              color: ink,
              backgroundColor: accentColor,
              padding: '4px 10px',
              border: `${Math.max(2, borderWidth - 1)}px solid ${ink}`,
              boxShadow: '3px 3px 0 #000',
              transform: 'rotate(-1.5deg)',
              display: 'inline-block',
            }}
          >
            CHAT
          </span>
          {statusMeta && (
            <span
              style={{
                marginLeft: 'auto',
                fontFamily: headingFont,
                fontWeight: 900,
                fontSize: common.scale(14),
                letterSpacing: 1.5,
                color: statusMeta.color,
                backgroundColor: statusMeta.bg,
                padding: '4px 9px',
                border: `${Math.max(2, borderWidth - 1)}px solid ${ink}`,
                boxShadow: '3px 3px 0 #000',
                transform: 'rotate(2deg)',
                textTransform: 'uppercase',
                display: 'inline-block',
              }}
            >
              {statusMeta.label}
            </span>
          )}
        </div>

        {!hasMessages ? (
          <div
            style={{
              padding: '32px 12px',
              border: `${borderWidth}px dashed ${ink}`,
              textAlign: 'center',
              fontFamily: headingFont,
              fontWeight: 900,
              fontSize: common.scale(22),
              letterSpacing: 2,
              textTransform: 'uppercase',
              color: ink,
            }}
          >
            WAITING...
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
            }}
          >
            {animatedMessages.map(({ message, phase, index }) => {
              const isDonation = isDonationEvent(message);
              const msgTilt = MESSAGE_TILTS[index % MESSAGE_TILTS.length];
              const tagTilt = PLATFORM_TAG_TILTS[index % PLATFORM_TAG_TILTS.length];

              const animationCss =
                phase === 'entering' && !reducedMotion
                  ? `brutalist-stamp ${enterDuration}ms steps(1, end) ${stagger * index}ms 1 both`
                  : phase === 'exiting' && !reducedMotion
                    ? `brutalist-disappear ${exitDuration}ms steps(1, end) 0ms 1 both`
                    : undefined;

              return (
                <li
                  key={message.id}
                  style={{
                    padding: 12,
                    backgroundColor: isDonation ? accentColor : '#ffffff',
                    border: `${borderWidth}px solid ${ink}`,
                    boxShadow: isDonation
                      ? `${shadowOffset + 2}px ${shadowOffset + 2}px 0 #000`
                      : `${Math.max(4, shadowOffset - 4)}px ${Math.max(4, shadowOffset - 4)}px 0 #000`,
                    transform: reducedMotion ? undefined : `rotate(${msgTilt}deg)`,
                    transformOrigin: 'center center',
                    animation: animationCss,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
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
                        display: 'inline-block',
                        fontFamily: headingFont,
                        fontWeight: 900,
                        fontSize: common.scale(12),
                        letterSpacing: 1.5,
                        color: isDonation ? accentColor : '#ffffff',
                        backgroundColor: ink,
                        padding: '3px 7px',
                        border: `2px solid ${ink}`,
                        transform: `rotate(${tagTilt}deg)`,
                        textTransform: 'uppercase',
                      }}
                    >
                      {platformLabel(message.platform)}
                    </span>
                    <span
                      style={{
                        fontFamily: headingFont,
                        fontWeight: 900,
                        fontSize: common.scale(16),
                        letterSpacing: -0.3,
                        color: ink,
                        textTransform: 'uppercase',
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
                          marginLeft: 'auto',
                          fontFamily: headingFont,
                          fontWeight: 900,
                          fontSize: common.scale(13),
                          letterSpacing: 1,
                          backgroundColor: ink,
                          color: accentColor,
                          padding: '3px 7px',
                          border: `2px solid ${ink}`,
                          transform: 'rotate(3deg)',
                          textTransform: 'uppercase',
                        }}
                      >
                        $$$ DONATION
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontFamily: bodyFont,
                      fontWeight: 700,
                      fontSize: common.scale(17),
                      lineHeight: 1.35,
                      color: ink,
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
