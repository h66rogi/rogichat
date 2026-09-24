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
import { defaultOptions, type NeonCyberpunkOptions } from './config';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): NeonCyberpunkOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<NeonCyberpunkOptions>),
  };
}

const PLATFORM_LABEL: Record<string, string> = {
  chzzk: 'CHZZK',
  soop: 'SOOP',
  cime: 'CIME',
  meloming: 'MELOMING',
};

const MAX_VISIBLE = 8;

function clampGlow(intensity: number): number {
  if (Number.isNaN(intensity)) return 75;
  return Math.max(0, Math.min(100, intensity));
}

/** Convert "#rrggbb" to "r, g, b" for use in rgba() text-shadow strings. */
function hexToRgbTriplet(hex: string, fallback = '255, 0, 255'): string {
  const match = hex.trim().match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!match) return fallback;
  const r = parseInt(match[1], 16);
  const g = parseInt(match[2], 16);
  const b = parseInt(match[3], 16);
  return `${r}, ${g}, ${b}`;
}

function isDonationEvent(event: OverlayChatEvent): boolean {
  return event.type === 'donation';
}

function platformLabel(platform: string): string {
  return PLATFORM_LABEL[platform] ?? platform.toUpperCase();
}

/**
 * Deterministic nickname color picker. Buckets each nickname into one of the
 * three neon hues (primary / secondary / accent) based on a stable hash so
 * the same user always lights up the same color.
 */
function pickNeonForNickname(
  nickname: string,
  primary: string,
  secondary: string,
  accent: string,
): string {
  if (!nickname) return primary;
  let hash = 0;
  for (let i = 0; i < nickname.length; i++) {
    hash = (hash * 31 + nickname.charCodeAt(i)) & 0xffffffff;
  }
  const bucket = Math.abs(hash) % 3;
  if (bucket === 0) return primary;
  if (bucket === 1) return secondary;
  return accent;
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
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.heading ?? ['Orbitron', 'sans-serif']),
    [common.fontFamily, fonts.roles.heading],
  );
  const bodyFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['Rajdhani', 'sans-serif']),
    [common.fontFamily, fonts.roles.body],
  );
  const accentFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.accent ?? ['Orbitron', 'monospace']),
    [common.fontFamily, fonts.roles.accent],
  );

  // Clamp the incoming message list to MAX_VISIBLE so the card doesn't
  // grow unbounded. The parent page already trims to maxMessages, but we
  // apply an extra cap so the neon frame never overflows.
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
  const glowScale = 0.2 + (glow / 100) * 0.9;

  const primaryNeon = common.accentColor ?? options.primaryNeon ?? '#ff00ff';
  const secondaryNeon = common.textColor ?? options.secondaryNeon ?? '#00fff7';
  const accentNeon = options.accentNeon || '#7b2ff7';
  const bgColor = options.backgroundColor || '#05000a';

  const primaryRgb = hexToRgbTriplet(primaryNeon, '255, 0, 255');
  const secondaryRgb = hexToRgbTriplet(secondaryNeon, '0, 255, 247');
  const accentRgb = hexToRgbTriplet(accentNeon, '123, 47, 247');

  const buildNeonTextShadow = (rgbTriplet: string, scale: number) => {
    const inner = `0 0 ${8 * scale}px rgba(${rgbTriplet}, ${Math.min(1, 0.9 * scale)})`;
    const mid = `0 0 ${16 * scale}px rgba(${rgbTriplet}, ${Math.min(1, 0.65 * scale)})`;
    const outer = `0 0 ${28 * scale}px rgba(${rgbTriplet}, ${Math.min(1, 0.4 * scale)})`;
    return `${inner}, ${mid}, ${outer}`;
  };

  const primaryShadow = buildNeonTextShadow(primaryRgb, glowScale);
  const secondaryShadow = buildNeonTextShadow(secondaryRgb, glowScale * 0.7);

  const enterDuration = animations['chat.enter']?.enterDuration ?? 400;
  const stagger = animations['chat.enter']?.stagger ?? 50;
  const exitDuration = animations['chat.exit']?.enterDuration ?? 200;
  const donationDuration = animations.donation?.enterDuration ?? 1000;

  const containerStyle: React.CSSProperties = useMemo(() => ({
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: bodyFont,
    fontWeight: common.fontWeight,
    color: secondaryNeon,
    background: 'transparent',
  }), [bodyFont, common.textSizeMultiplier, common.fontWeight, secondaryNeon]);

  // React Compiler handles memoization for these styles; manual useMemo
  // would conflict with deps that the compiler considers potentially mutated
  // (primaryRgb / secondaryRgb are also passed as JSX props elsewhere).
  const frameStyle: React.CSSProperties = {
    flex: 1,
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    padding: '14px 16px',
    backgroundColor: hexToRgba(bgColor, common.backgroundOpacity),
    border: `1px solid rgba(${primaryRgb}, ${0.35 * common.borderOpacity})`,
    borderRadius: 2,
    boxShadow: `inset 0 0 ${26 * glowScale}px rgba(${primaryRgb}, ${0.08 * glowScale})`,
    overflow: 'hidden',
    backdropFilter: buildBlurFilter(common.blurIntensity),
    WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
    paddingBottom: 10,
    borderBottom: `1px solid rgba(${secondaryRgb}, 0.3)`,
  };

  const statusMeta = (() => {
    switch (connectionStatus) {
      case 'connected':
        return { label: 'ONLINE', color: secondaryNeon, rgb: secondaryRgb };
      case 'connecting':
        return { label: 'SYNCING', color: primaryNeon, rgb: primaryRgb };
      case 'reconnecting':
        return { label: 'RECONNECT', color: primaryNeon, rgb: primaryRgb };
      case 'disconnected':
        return { label: 'OFFLINE', color: '#ff4d4d', rgb: '255, 77, 77' };
      default:
        return null;
    }
  })();

  const hasMessages = animatedMessages.length > 0;

  return (
    <div style={containerStyle}>
      <div style={frameStyle}>
        {options.showScanlines && <ScanlineOverlay />}
        <NeonEdges primaryRgb={primaryRgb} secondaryRgb={secondaryRgb} glowScale={glowScale} />

        <div style={headerStyle}>
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: statusMeta?.color ?? primaryNeon,
              boxShadow: `0 0 6px ${statusMeta?.color ?? primaryNeon}, 0 0 12px ${statusMeta?.color ?? primaryNeon}`,
              animation: reducedMotion
                ? undefined
                : 'neon-cyberpunk-status-pulse 1.4s ease-in-out infinite',
            }}
          />
          <span
            style={{
              fontFamily: accentFont,
              fontSize: common.scale(12),
              letterSpacing: 3,
              textTransform: 'uppercase',
              color: primaryNeon,
              textShadow: primaryShadow,
            }}
          >
            CHAT STREAM
          </span>
          {statusMeta && (
            <span
              style={{
                marginLeft: 'auto',
                fontFamily: accentFont,
                fontSize: common.scale(11),
                letterSpacing: 2,
                padding: '3px 8px',
                border: `1px solid rgba(${statusMeta.rgb}, 0.7)`,
                color: statusMeta.color,
                textShadow: `0 0 ${8 * glowScale}px rgba(${statusMeta.rgb}, ${0.8 * glowScale})`,
                textTransform: 'uppercase',
              }}
            >
              {statusMeta.label}
            </span>
          )}
        </div>

        {!hasMessages ? (
          <div
            style={{
              minHeight: 120,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
              fontFamily: headingFont,
              fontSize: common.scale(13),
              letterSpacing: 2,
              color: secondaryNeon,
              textShadow: secondaryShadow,
              textTransform: 'uppercase',
            }}
          >
            NO TRANSMISSIONS
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
              const nickColor = pickNeonForNickname(
                message.nickname,
                primaryNeon,
                secondaryNeon,
                accentNeon,
              );
              const nickRgb = hexToRgbTriplet(
                nickColor,
                nickColor === primaryNeon
                  ? primaryRgb
                  : nickColor === secondaryNeon
                    ? secondaryRgb
                    : accentRgb,
              );
              const nickShadow = buildNeonTextShadow(nickRgb, glowScale * 0.75);

              const animationCss =
                phase === 'entering' && !reducedMotion
                  ? `neon-cyberpunk-neon-fadein ${enterDuration}ms ease-out ${stagger * index}ms 1 both`
                  : phase === 'exiting' && !reducedMotion
                    ? `neon-cyberpunk-glitch-out ${exitDuration}ms ease-in 0ms 1 both`
                    : undefined;

              // Donation messages get a larger card and the glow explosion.
              const donationAnimation =
                isDonation && phase === 'entering' && !reducedMotion
                  ? `neon-cyberpunk-glow-explosion ${donationDuration}ms ease-out 0ms 1 both`
                  : undefined;

              const itemStyle: React.CSSProperties = {
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                padding: isDonation ? '12px 14px' : '8px 10px',
                border: isDonation
                  ? `1px solid rgba(${primaryRgb}, 0.85)`
                  : `1px solid rgba(${secondaryRgb}, 0.3)`,
                backgroundColor: isDonation
                  ? `rgba(${primaryRgb}, 0.08)`
                  : `rgba(${secondaryRgb}, 0.04)`,
                boxShadow: isDonation
                  ? `0 0 ${16 * glowScale}px rgba(${primaryRgb}, ${0.55 * glowScale}), inset 0 0 ${12 * glowScale}px rgba(${primaryRgb}, ${0.15 * glowScale})`
                  : `0 0 ${6 * glowScale}px rgba(${secondaryRgb}, ${0.2 * glowScale})`,
                borderRadius: 2,
                animation: donationAnimation ?? animationCss,
              };

              return (
                <li key={message.id} style={itemStyle}>
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
                        letterSpacing: 1.5,
                        padding: '2px 6px',
                        border: `1px solid rgba(${secondaryRgb}, 0.6)`,
                        color: secondaryNeon,
                        textShadow: secondaryShadow,
                        textTransform: 'uppercase',
                      }}
                    >
                      {platformLabel(message.platform)}
                    </span>
                    <span
                      style={{
                        fontFamily: headingFont,
                        fontSize: common.scale(isDonation ? 16 : 15),
                        fontWeight: 700,
                        color: nickColor,
                        textShadow: nickShadow,
                        letterSpacing: 0.8,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: 220,
                        textTransform: 'uppercase',
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
                          letterSpacing: 2,
                          padding: '2px 6px',
                          border: `1px solid rgba(${primaryRgb}, 0.8)`,
                          color: primaryNeon,
                          textShadow: primaryShadow,
                          textTransform: 'uppercase',
                        }}
                      >
                        {'\u2605'} TIP
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontFamily: bodyFont,
                      fontSize: common.scale(17),
                      lineHeight: 1.4,
                      color: isDonation ? '#ffffff' : secondaryNeon,
                      textShadow: isDonation
                        ? `0 0 ${8 * glowScale}px rgba(255, 255, 255, ${0.5 * glowScale}), 0 0 ${14 * glowScale}px rgba(${primaryRgb}, ${0.5 * glowScale})`
                        : `0 0 ${6 * glowScale}px rgba(${secondaryRgb}, ${0.35 * glowScale})`,
                      wordBreak: 'break-word',
                      paddingLeft: 2,
                    }}
                  >
                    <ChatMessageContent message={message.message} platform={message.platform} emotes={message.emotes} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Donation flash: extra global glow on the card frame when a
            donation lands. This is separate from the per-message explosion. */}
        {donationFlash && !reducedMotion && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              boxShadow: `inset 0 0 ${60 * glowScale}px rgba(${primaryRgb}, ${0.35 * glowScale}), inset 0 0 ${120 * glowScale}px rgba(${secondaryRgb}, ${0.2 * glowScale})`,
            }}
          />
        )}
      </div>
    </div>
  );
}

function ScanlineOverlay() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        backgroundImage:
          'repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.32) 0, rgba(0, 0, 0, 0.32) 1px, transparent 1px, transparent 3px)',
        mixBlendMode: 'multiply',
        opacity: 0.7,
      }}
    />
  );
}

function NeonEdges({
  primaryRgb,
  secondaryRgb,
  glowScale,
}: {
  primaryRgb: string;
  secondaryRgb: string;
  glowScale: number;
}) {
  const topLine: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    background: `linear-gradient(90deg, rgba(${primaryRgb}, 0) 0%, rgba(${primaryRgb}, 1) 50%, rgba(${secondaryRgb}, 0) 100%)`,
    boxShadow: `0 0 ${8 * glowScale}px rgba(${primaryRgb}, ${0.8 * glowScale})`,
    pointerEvents: 'none',
  };
  const bottomLine: React.CSSProperties = {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 1,
    background: `linear-gradient(90deg, rgba(${secondaryRgb}, 0) 0%, rgba(${secondaryRgb}, 1) 50%, rgba(${primaryRgb}, 0) 100%)`,
    boxShadow: `0 0 ${8 * glowScale}px rgba(${secondaryRgb}, ${0.8 * glowScale})`,
    pointerEvents: 'none',
  };
  return (
    <>
      <div aria-hidden="true" style={topLine} />
      <div aria-hidden="true" style={bottomLine} />
    </>
  );
}
Chatbox.displayName = 'Chatbox';
export default memo(Chatbox);
