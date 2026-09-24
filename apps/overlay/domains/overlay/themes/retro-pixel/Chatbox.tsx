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
import { defaultOptions, type RetroPixelOptions } from './config';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): RetroPixelOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<RetroPixelOptions>),
  };
}

// Platform labels render uppercased for the arcade marquee aesthetic.
const PLATFORM_LABEL: Record<string, string> = {
  chzzk: 'CHZZK',
  soop: 'SOOP',
  cime: 'CIME',
  meloming: 'MELOMING',
};

const MAX_VISIBLE = 8;

function clampGlow(intensity: number): number {
  if (Number.isNaN(intensity)) return 60;
  return Math.max(0, Math.min(100, intensity));
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
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.heading ?? ['monospace']),
    [common.fontFamily, fonts.roles.heading],
  );
  const bodyFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['monospace']),
    [common.fontFamily, fonts.roles.body],
  );

  // Clamp the incoming message list to MAX_VISIBLE so the CRT frame doesn't
  // grow unbounded. The parent page already trims to `maxMessages`, but we
  // apply an extra cap so the pixel frame never overflows.
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

  const glow = clampGlow(options.glowIntensity);
  const glowAlpha = 0.35 + (glow / 100) * 0.55;
  const glowBlur = 6 + (glow / 100) * 18;
  const borderColor = options.primaryColor;
  const accentColor = common.accentColor ?? options.accentColor;
  const bodyTextColor = common.textColor ?? accentColor;
  const bgColor = options.backgroundColor;
  const pixelScale = Math.max(1, Math.min(4, options.pixelScale ?? 2));
  const borderWidth = pixelScale * 2;

  const titleShadow = `0 0 ${glowBlur * 0.6}px rgba(255, 110, 199, ${glowAlpha}), 2px 2px 0 rgba(0, 0, 0, 0.85)`;
  const accentShadow = `0 0 ${glowBlur * 0.5}px rgba(0, 255, 247, ${glowAlpha * 0.8}), 1px 1px 0 rgba(0, 0, 0, 0.85)`;

  const enterDuration = animations['chat.enter']?.enterDuration ?? 200;
  const stagger = animations['chat.enter']?.stagger ?? 0;
  const exitDuration = animations['chat.exit']?.enterDuration ?? 150;

  const containerStyle: React.CSSProperties = useMemo(() => ({
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: bodyFont,
    fontWeight: common.fontWeight,
    color: bodyTextColor,
    background: 'transparent',
  }), [bodyFont, bodyTextColor, common.textSizeMultiplier, common.fontWeight]);

  const frameStyle: React.CSSProperties = useMemo(() => {
    const glow = `0 0 0 ${pixelScale}px rgba(0, 0, 0, 0.85)`;
    return {
      flex: 1,
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: hexToRgba(bgColor, common.backgroundOpacity),
      border: `${borderWidth}px solid ${withOpacity(borderColor, common.borderOpacity)}`,
      borderRadius: 0,
      padding: pixelScale * 8,
      position: 'relative',
      boxShadow: donationFlash
        ? `${glow}, 0 0 ${glowBlur * 2}px rgba(255, 215, 0, ${glowAlpha})`
        : glow,
      overflow: 'hidden',
      imageRendering: 'pixelated',
      transition: 'box-shadow 200ms steps(4, end)',
      backdropFilter: buildBlurFilter(common.blurIntensity),
      WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
    };
  }, [bgColor, borderColor, borderWidth, donationFlash, glowAlpha, glowBlur, pixelScale, common.backgroundOpacity, common.borderOpacity, common.blurIntensity]);

  const headerStyle: React.CSSProperties = useMemo(() => {
    const shadow = `0 0 ${glowBlur * 0.6}px rgba(255, 110, 199, ${glowAlpha}), 2px 2px 0 rgba(0, 0, 0, 0.85)`;
    return {
      fontFamily: headingFont,
      color: borderColor,
      fontSize: common.scale(17),
      letterSpacing: 2,
      paddingBottom: pixelScale * 4,
      marginBottom: pixelScale * 6,
      borderBottom: `${pixelScale}px dashed ${accentColor}`,
      textShadow: shadow,
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      textTransform: 'uppercase',
    };
  }, [accentColor, borderColor, glowAlpha, glowBlur, headingFont, pixelScale, common.textSizeMultiplier]);

  // Resolve a short status label for the header so streamers can see whether
  // the socket is live / reconnecting without having to debug the overlay.
  const statusLabel = (() => {
    switch (connectionStatus) {
      case 'connected':
        return 'ONLINE';
      case 'connecting':
        return 'SYNCING';
      case 'reconnecting':
        return 'RECONNECT';
      case 'disconnected':
        return 'OFFLINE';
      default:
        return null;
    }
  })();

  const statusColor = (() => {
    switch (connectionStatus) {
      case 'connected':
        return accentColor;
      case 'disconnected':
        return '#ff4d4d';
      default:
        return borderColor;
    }
  })();

  const hasMessages = animatedMessages.length > 0;

  return (
    <div style={containerStyle}>
      <div style={frameStyle}>
        {options.showScanlines && <ScanlinesOverlay />}
        <CrtCorners color={borderColor} pixelScale={pixelScale} />

        <div style={headerStyle}>
          <span aria-hidden="true">{'\u25C6'}</span>
          <span>CHAT FEED</span>
          {statusLabel && (
            <span
              style={{
                marginLeft: 'auto',
                fontSize: common.scale(11),
                letterSpacing: 1,
                color: statusColor,
                textShadow: 'none',
                padding: '1px 4px',
                border: `${Math.max(1, pixelScale - 1)}px solid ${statusColor}`,
              }}
            >
              {statusLabel}
            </span>
          )}
        </div>

        {!hasMessages ? (
          <div
            style={{
              fontFamily: headingFont,
              color: accentColor,
              fontSize: common.scale(10),
              letterSpacing: 2,
              padding: `${pixelScale * 8}px ${pixelScale * 4}px`,
              textAlign: 'center',
              textShadow: accentShadow,
              opacity: 0.8,
            }}
          >
            {connectionStatus === 'connected'
              ? 'INSERT COIN // WAITING FOR CHAT'
              : connectionStatus === 'disconnected'
                ? 'CONNECTION LOST'
                : 'PRESS START'}
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
              gap: pixelScale * 4,
              justifyContent: 'flex-end',
              overflow: 'hidden auto',
            }}
          >
            {animatedMessages.map(({ message, phase, index }) => {
              const isDonation = isDonationEvent(message);
              const animationCss =
                phase === 'entering' && !reducedMotion
                  ? `retro-pixel-typewriter ${enterDuration}ms steps(20, end) ${stagger * index}ms 1 both`
                  : phase === 'exiting' && !reducedMotion
                    ? `retro-pixel-fade-out ${exitDuration}ms ease-out 0ms 1 both`
                    : undefined;

              return (
                <li
                  key={message.id}
                  style={{
                    border: `${pixelScale}px solid ${
                      isDonation ? '#ffd700' : accentColor
                    }`,
                    backgroundColor: isDonation
                      ? `${borderColor}22`
                      : 'rgba(0, 0, 0, 0.55)',
                    padding: pixelScale * 4,
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
                      fontFamily: headingFont,
                      fontSize: common.scale(12),
                    }}
                  >
                    <span
                      style={{
                        backgroundColor: isDonation ? '#ffd700' : accentColor,
                        color: bgColor,
                        padding: '2px 5px',
                        letterSpacing: 1,
                        textShadow: 'none',
                      }}
                    >
                      {platformLabel(message.platform)}
                    </span>
                    <span
                      style={{
                        fontSize: common.scale(15),
                        color: borderColor,
                        textShadow: titleShadow,
                        letterSpacing: 0.5,
                      }}
                    >
                      {message.nickname}
                      {isDonation && (
                        <span
                          aria-hidden="true"
                          style={{
                            marginLeft: 6,
                            color: '#ffd700',
                            textShadow: `0 0 ${glowBlur * 0.4}px #ffd70080`,
                          }}
                        >
                          {'\u2605'}
                        </span>
                      )}
                    </span>
                  </div>
                  <div
                    style={{
                      fontFamily: bodyFont,
                      fontSize: common.scale(17),
                      color: isDonation ? '#ffd700' : accentColor,
                      textShadow: isDonation
                        ? `0 0 ${glowBlur * 0.6}px #ffd70080`
                        : accentShadow,
                      wordBreak: 'break-word',
                      paddingLeft: 4,
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

function ScanlinesOverlay() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        backgroundImage:
          'repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.45) 0, rgba(0, 0, 0, 0.45) 1px, transparent 1px, transparent 3px)',
        mixBlendMode: 'multiply',
        opacity: 0.55,
      }}
    />
  );
}

function CrtCorners({ color, pixelScale }: { color: string; pixelScale: number }) {
  const size = pixelScale * 4 + 4;
  const corner: React.CSSProperties = {
    position: 'absolute',
    width: size,
    height: size,
    pointerEvents: 'none',
  };
  const lineThickness = Math.max(2, pixelScale);
  const horizontal: React.CSSProperties = {
    position: 'absolute',
    width: size,
    height: lineThickness,
    backgroundColor: color,
  };
  const vertical: React.CSSProperties = {
    position: 'absolute',
    width: lineThickness,
    height: size,
    backgroundColor: color,
  };
  return (
    <>
      <div aria-hidden="true" style={{ ...corner, top: -lineThickness, left: -lineThickness }}>
        <div style={{ ...horizontal, top: 0, left: 0 }} />
        <div style={{ ...vertical, top: 0, left: 0 }} />
      </div>
      <div aria-hidden="true" style={{ ...corner, top: -lineThickness, right: -lineThickness }}>
        <div style={{ ...horizontal, top: 0, right: 0 }} />
        <div style={{ ...vertical, top: 0, right: 0 }} />
      </div>
      <div aria-hidden="true" style={{ ...corner, bottom: -lineThickness, left: -lineThickness }}>
        <div style={{ ...horizontal, bottom: 0, left: 0 }} />
        <div style={{ ...vertical, bottom: 0, left: 0 }} />
      </div>
      <div aria-hidden="true" style={{ ...corner, bottom: -lineThickness, right: -lineThickness }}>
        <div style={{ ...horizontal, bottom: 0, right: 0 }} />
        <div style={{ ...vertical, bottom: 0, right: 0 }} />
      </div>
    </>
  );
}
Chatbox.displayName = 'Chatbox';
export default memo(Chatbox);
