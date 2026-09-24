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
import { defaultOptions, type ConcertPosterOptions } from './config';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): ConcertPosterOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<ConcertPosterOptions>),
  };
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

function buildSoftShadow(offset: number, color: string): string {
  // Single soft drop shadow only — no hard box silhouette behind text.
  const o = Math.max(1, Math.round(offset));
  return `0 ${o}px ${o * 3 + 2}px ${color}88`;
}

function Chatbox({
  options: rawOptions,
  animations,
  fonts,
  reducedMotion,
  chatMessages,
}: Props) {
  const options = useMemo(() => resolveOptions(rawOptions), [rawOptions]);
  const common = useCommonOptions(rawOptions);
  const headingFont = useMemo(
    () =>
      common.fontFamily ??
      buildFontFamilyValue(fonts.roles.heading ?? ['IBM Plex Sans', 'sans-serif']),
    [common.fontFamily, fonts.roles.heading],
  );
  const bodyFont = useMemo(
    () =>
      common.fontFamily ??
      buildFontFamilyValue(fonts.roles.body ?? ['IBM Plex Sans', 'sans-serif']),
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

  const accent = common.accentColor ?? options.accentColor;
  const titleColor = common.textColor ?? options.titleColor;
  const textColor = options.textColor;
  const shadow = buildSoftShadow(options.shadowOffset, options.shadowColor);
  const thinShadow = `1px 1px 0 ${options.shadowColor}`;

  const enterDuration = animations['chat.enter']?.enterDuration ?? 220;
  const stagger = animations['chat.enter']?.stagger ?? 35;
  const exitDuration = animations['chat.exit']?.enterDuration ?? 140;

  const containerStyle: React.CSSProperties = useMemo(
    () => ({
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      padding: 20,
      fontFamily: headingFont,
      fontWeight: common.fontWeight,
      color: titleColor,
      background: 'transparent',
      pointerEvents: 'none',
      backdropFilter: buildBlurFilter(common.blurIntensity),
      WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
    }),
    [headingFont, common.fontWeight, common.blurIntensity, titleColor],
  );

  const hasMessages = animatedMessages.length > 0;

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 14,
        }}
      >
        <div
          style={{
            width: 4,
            height: 32,
            borderRadius: 999,
            background: accent,
            boxShadow: `0 0 10px ${hexToRgba(accent, 0.6)}`,
          }}
        />
        <span
          style={{
            fontSize: common.scale(20),
            fontWeight: 800,
            letterSpacing: '-0.015em',
            color: titleColor,
            textShadow: shadow,
          }}
        >
          채팅
        </span>
      </div>

      {!hasMessages ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: common.scale(14),
            fontWeight: 900,
            letterSpacing: '0.3em',
            color: options.mutedColor,
            textShadow: thinShadow,
            textTransform: 'uppercase',
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
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            flex: 1,
            overflow: 'hidden',
          }}
        >
          {animatedMessages.map(({ message, phase, index }) => {
            const isDonation = isDonationEvent(message);

            const animationCss =
              phase === 'entering' && !reducedMotion
                ? `concert-poster-poster-stamp ${enterDuration}ms cubic-bezier(0.22, 1, 0.36, 1) ${stagger * index}ms 1 both`
                : phase === 'exiting' && !reducedMotion
                  ? `concert-poster-poster-fade-out ${exitDuration}ms ease-in 1 both`
                  : undefined;

            return (
              <li
                key={message.id}
                style={{
                  padding: '8px 12px',
                  borderLeft: `3px solid ${
                    isDonation ? accent : hexToRgba('#ffffff', 0.18)
                  }`,
                  background: isDonation
                    ? hexToRgba(accent, 0.2)
                    : hexToRgba('#000000', 0.25),
                  backdropFilter: 'blur(2px)',
                  animation: animationCss,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
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
                      fontSize: common.scale(9),
                      fontWeight: 900,
                      letterSpacing: '0.2em',
                      color: titleColor,
                      background: hexToRgba('#000000', 0.55),
                      padding: '2px 6px',
                      borderRadius: 3,
                      textShadow: thinShadow,
                    }}
                  >
                    {platformLabel(message.platform)}
                  </span>
                  <span
                    style={{
                      fontSize: common.scale(14),
                      fontWeight: 900,
                      color: titleColor,
                      letterSpacing: '-0.01em',
                      textShadow: shadow,
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
                        fontSize: common.scale(9),
                        fontWeight: 900,
                        letterSpacing: '0.2em',
                        background: accent,
                        color: titleColor,
                        padding: '2px 6px',
                        borderRadius: 3,
                        textShadow: thinShadow,
                      }}
                    >
                      DONATION
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontFamily: bodyFont,
                    fontSize: common.scale(13),
                    fontWeight: 600,
                    color: textColor,
                    textShadow: thinShadow,
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
  );
}

Chatbox.displayName = 'Chatbox';
export default memo(Chatbox);
