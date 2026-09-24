'use client';

import { memo, useMemo } from 'react';
import type { ThemeWidgetProps } from '../types';
import type { OverlayChatEvent } from '../../types/chat';
import { ChatMessageContent } from '../../components/shared/ChatMessageContent';
import {
  buildFontFamilyValue,
  useChatAnimation,
  useCommonOptions,
} from '../shared';
import { hexToRgba, withOpacity, buildBlurFilter } from '../shared/apply-transparency';
import { defaultOptions, type SportsTickerOptions } from './config';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): SportsTickerOptions {
  return { ...defaultOptions, ...(raw as Partial<SportsTickerOptions>) };
}

const PLATFORM_LABEL: Record<string, string> = {
  chzzk: 'CHZZK',
  soop: 'SOOP',
  cime: 'CIME',
  meloming: 'MELOMING',
};

const MAX_VISIBLE = 8;

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
    () =>
      common.fontFamily ??
      buildFontFamilyValue(fonts.roles.heading ?? ['Inter', 'sans-serif']),
    [common.fontFamily, fonts.roles.heading],
  );
  const bodyFont = useMemo(
    () =>
      common.fontFamily ??
      buildFontFamilyValue(
        fonts.roles.body ?? ['Roboto Condensed', 'sans-serif'],
      ),
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

  const brandColor = options.brandColor || common.accentColor || "#c0392b";
  const accentColor = options.accentColor;
  const textColor = common.textColor ?? options.textColor;
  const bgColor = options.backgroundColor;

  const enterDuration = animations['chat.enter']?.enterDuration ?? 400;
  const stagger = animations['chat.enter']?.stagger ?? 60;
  const exitDuration = animations['chat.exit']?.enterDuration ?? 300;

  const containerStyle: React.CSSProperties = useMemo(
    () => ({
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      padding: 16,
      fontFamily: bodyFont,
      fontWeight: common.fontWeight,
      color: textColor,
      background: hexToRgba(bgColor, common.backgroundOpacity * 0.85),
      border: `1px solid ${withOpacity(brandColor, 0.45 * common.borderOpacity)}`,
      backdropFilter: buildBlurFilter(common.blurIntensity),
      WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
      pointerEvents: 'none',
      position: 'relative',
    }),
    [
      bgColor,
      bodyFont,
      brandColor,
      common.backgroundOpacity,
      common.blurIntensity,
      common.borderOpacity,
      common.fontWeight,
      textColor,
    ],
  );

  const onAirLabel = useMemo<{ live: boolean; label: string } | null>(() => {
    switch (connectionStatus) {
      case 'connected':
        return { live: true, label: 'ON AIR' };
      case 'connecting':
        return { live: false, label: 'SYNC' };
      case 'reconnecting':
        return { live: false, label: 'RETRY' };
      case 'disconnected':
        return { live: false, label: 'OFFLINE' };
      default:
        return null;
    }
  }, [connectionStatus]);

  const hasMessages = animatedMessages.length > 0;

  return (
    <div style={containerStyle}>
      {/* Connection status pill in the corner — static (no blink) so the
          chatbox doesn't visually compete with the LIVE indicator on the
          NowPlaying widget. */}
      {onAirLabel && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 16,
            fontFamily: headingFont,
            fontWeight: 900,
            fontSize: common.scale(10),
            letterSpacing: 1.5,
            color: onAirLabel.live ? brandColor : textColor,
            backgroundColor: onAirLabel.live ? textColor : accentColor,
            padding: '3px 7px',
            border: `1px solid ${onAirLabel.live ? brandColor : textColor}`,
          }}
        >
          {onAirLabel.label}
        </div>
      )}

      {!hasMessages ? (
        <div
          style={{
            fontFamily: headingFont,
            fontWeight: 900,
            fontSize: common.scale(14),
            letterSpacing: 2,
            color: textColor,
            opacity: 0.6,
            padding: '24px 12px',
            textAlign: 'center',
            border: `1px dashed ${hexToRgba(textColor, 0.4)}`,
          }}
        >
          [STANDBY]
        </div>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            maxHeight: '100%',
            overflow: 'hidden',
          }}
        >
          {animatedMessages.map(({ message, phase, index }) => {
            const isDonation = isDonationEvent(message);

            const animationCss =
              phase === 'entering' && !reducedMotion
                ? `sports-ticker-ticker-scroll-in ${enterDuration}ms ease-out ${stagger * index}ms 1 both`
                : phase === 'exiting' && !reducedMotion
                  ? `sports-ticker-scroll-out ${exitDuration}ms ease-in 0ms 1 both`
                  : undefined;

            // Donation: full-width BREAKING NEWS banner — no color-toggle
            // flash, just a slide-in once and then static. (Constant
            // bg-color blink got distracting under heavy donation flow.)
            if (isDonation) {
              return (
                <li
                  key={message.id}
                  style={{
                    position: 'relative',
                    padding: '10px 14px',
                    backgroundColor: brandColor,
                    color: textColor,
                    border: `2px solid ${textColor}`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    width: '100%',
                    animation: animationCss,
                  }}
                >
                  <div
                    style={{
                      fontFamily: headingFont,
                      fontWeight: 900,
                      fontSize: common.scale(11),
                      letterSpacing: 2,
                      textTransform: 'uppercase',
                      opacity: 0.95,
                    }}
                  >
                    BREAKING NEWS / {platformLabel(message.platform)} /{' '}
                    {message.nickname}
                  </div>
                  <div
                    style={{
                      fontFamily: bodyFont,
                      fontWeight: 700,
                      fontSize: common.scale(15),
                      lineHeight: 1.3,
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                      wordBreak: 'break-word',
                    }}
                  >
                    <ChatMessageContent message={message.message} platform={message.platform} emotes={message.emotes} />
                  </div>
                </li>
              );
            }

            // Regular chat row.
            return (
              <li
                key={message.id}
                style={{
                  padding: '6px 10px',
                  borderLeft: `3px solid ${brandColor}`,
                  background: hexToRgba(textColor, 0.04),
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  animation: animationCss,
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
                      fontFamily: headingFont,
                      fontWeight: 900,
                      fontSize: common.scale(9),
                      letterSpacing: 1.5,
                      color: textColor,
                      backgroundColor: hexToRgba('#000000', 0.55),
                      padding: '2px 5px',
                    }}
                  >
                    {platformLabel(message.platform)}
                  </span>
                  <span
                    style={{
                      fontFamily: headingFont,
                      fontWeight: 800,
                      fontSize: common.scale(13),
                      color: brandColor,
                      letterSpacing: '0.05em',
                      textTransform: 'uppercase',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: 220,
                    }}
                  >
                    {message.nickname}
                  </span>
                </div>
                <div
                  style={{
                    fontFamily: bodyFont,
                    fontWeight: 600,
                    fontSize: common.scale(13),
                    lineHeight: 1.35,
                    color: textColor,
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
  );
}

Chatbox.displayName = 'Chatbox';
export default memo(Chatbox);
