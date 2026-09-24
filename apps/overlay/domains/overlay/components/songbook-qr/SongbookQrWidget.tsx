'use client';

import type { CSSProperties } from 'react';
import type { OverlayData } from '@/domains/overlay/types/overlay';
import type { ThemeFonts } from '@/domains/overlay/themes/types';
import {
  buildFontFamilyValue,
  cqwCap,
  useCommonOptions,
  useContainerUnitsSupport,
} from '@/domains/overlay/themes/shared';

function normalizeBaseUrl(value: string | undefined | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/\/$/, '');
  return trimmed || null;
}

function inferFrontBaseUrl(): string {
  const explicit =
    normalizeBaseUrl(process.env.NEXT_PUBLIC_FRONT_BASE_URL) ??
    normalizeBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);
  if (explicit) return explicit;

  const apiBase = normalizeBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL);
  if (apiBase) {
    try {
      const url = new URL(apiBase);
      if (url.hostname.startsWith('api.')) {
        url.hostname = url.hostname.replace(/^api\./, '');
      }
      url.pathname = '';
      url.search = '';
      url.hash = '';
      return url.toString().replace(/\/$/, '');
    } catch {
      // Fall through to runtime/default origin.
    }
  }

  if (typeof window !== 'undefined' && window.location.origin) {
    return window.location.origin.replace(/\/$/, '');
  }

  return 'https://meloming.com';
}

export function buildSongbookUrl(data?: OverlayData | null): string {
  const base = inferFrontBaseUrl();
  const webPath = data?.channel?.webPath?.trim();
  if (!webPath) return base;
  return `${base}/channel/${encodeURIComponent(webPath)}/musicbook`;
}

interface SongbookQrWidgetProps {
  data?: OverlayData | null;
  options?: Record<string, unknown> | null;
  fonts?: ThemeFonts | null;
  themeId?: string | null;
}

type QrThemeVariant =
  | 'spotify'
  | 'apple'
  | 'billboard'
  | 'retro-pixel'
  | 'glassmorphism'
  | 'brutalist'
  | 'kawaii'
  | 'vinyl-analog'
  | 'neon-cyberpunk'
  | 'hand-drawn'
  | 'korean-traditional'
  | '3d-depth'
  | 'sports-ticker'
  | 'concert-poster';

interface QrThemeProfile {
  variant: QrThemeVariant;
  label: string;
  surface: string;
  text: string;
  accent: string;
  border: string;
  shadow: string;
  radius: number;
  qrRadius: number;
  borderWidth: number;
  padding: string;
  captionAlign: CSSProperties['textAlign'];
}

const QR_THEME_PROFILES: Record<QrThemeVariant, QrThemeProfile> = {
  spotify: {
    variant: 'spotify',
    label: '노래책',
    surface: '#121212',
    text: '#ffffff',
    accent: '#1db954',
    border: '#1db954',
    shadow: 'rgba(0, 0, 0, 0.36)',
    radius: 18,
    qrRadius: 12,
    borderWidth: 1,
    padding: '5%',
    captionAlign: 'left',
  },
  apple: {
    variant: 'apple',
    label: '노래책',
    surface: 'rgba(255, 255, 255, 0.72)',
    text: '#111111',
    accent: '#fa2d48',
    border: '#ffffff',
    shadow: 'rgba(0, 0, 0, 0.14)',
    radius: 24,
    qrRadius: 16,
    borderWidth: 1,
    padding: '5%',
    captionAlign: 'center',
  },
  billboard: {
    variant: 'billboard',
    label: '노래책',
    surface: '#ffef00',
    text: '#050505',
    accent: '#ff2d2d',
    border: '#050505',
    shadow: '#050505',
    radius: 0,
    qrRadius: 0,
    borderWidth: 4,
    padding: '5%',
    captionAlign: 'left',
  },
  'retro-pixel': {
    variant: 'retro-pixel',
    label: '노래책',
    surface: '#0a0a1a',
    text: '#ff6ec7',
    accent: '#00fff7',
    border: '#ff6ec7',
    shadow: 'rgba(0, 255, 247, 0.42)',
    radius: 0,
    qrRadius: 0,
    borderWidth: 4,
    padding: '5%',
    captionAlign: 'left',
  },
  glassmorphism: {
    variant: 'glassmorphism',
    label: '노래책',
    surface: 'rgba(255, 255, 255, 0.18)',
    text: '#ffffff',
    accent: '#a78bfa',
    border: '#ffffff',
    shadow: 'rgba(31, 38, 135, 0.28)',
    radius: 24,
    qrRadius: 18,
    borderWidth: 1,
    padding: '5%',
    captionAlign: 'center',
  },
  brutalist: {
    variant: 'brutalist',
    label: '노래책',
    surface: '#ffff00',
    text: '#000000',
    accent: '#ff0000',
    border: '#000000',
    shadow: '#000000',
    radius: 0,
    qrRadius: 0,
    borderWidth: 5,
    padding: '5%',
    captionAlign: 'left',
  },
  kawaii: {
    variant: 'kawaii',
    label: '노래책',
    surface: '#fff8fb',
    text: '#d63384',
    accent: '#ff8fc7',
    border: '#ffb6d9',
    shadow: 'rgba(214, 51, 132, 0.16)',
    radius: 28,
    qrRadius: 18,
    borderWidth: 2,
    padding: '5%',
    captionAlign: 'center',
  },
  'vinyl-analog': {
    variant: 'vinyl-analog',
    label: '노래책',
    surface: '#2a2119',
    text: '#f4e7d3',
    accent: '#d9a441',
    border: '#6d5338',
    shadow: 'rgba(0, 0, 0, 0.48)',
    radius: 18,
    qrRadius: 14,
    borderWidth: 1,
    padding: '5%',
    captionAlign: 'center',
  },
  'neon-cyberpunk': {
    variant: 'neon-cyberpunk',
    label: '노래책',
    surface: '#070b1d',
    text: '#00fff7',
    accent: '#ff00ff',
    border: '#00fff7',
    shadow: 'rgba(0, 255, 247, 0.46)',
    radius: 8,
    qrRadius: 4,
    borderWidth: 1,
    padding: '5%',
    captionAlign: 'left',
  },
  'hand-drawn': {
    variant: 'hand-drawn',
    label: '노래책',
    surface: '#fffdf5',
    text: '#2c2c2c',
    accent: '#ff6b6b',
    border: '#2c2c2c',
    shadow: 'rgba(44, 44, 44, 0.16)',
    radius: 14,
    qrRadius: 8,
    borderWidth: 2,
    padding: '5%',
    captionAlign: 'center',
  },
  'korean-traditional': {
    variant: 'korean-traditional',
    label: '노래책',
    surface: '#fbf3e2',
    text: '#2b2118',
    accent: '#b3261e',
    border: '#8a5a32',
    shadow: 'rgba(88, 52, 25, 0.2)',
    radius: 4,
    qrRadius: 2,
    borderWidth: 1,
    padding: '5%',
    captionAlign: 'center',
  },
  '3d-depth': {
    variant: '3d-depth',
    label: '노래책',
    surface: '#1e293b',
    text: '#ffffff',
    accent: '#8b5cf6',
    border: '#a78bfa',
    shadow: 'rgba(0, 0, 0, 0.5)',
    radius: 16,
    qrRadius: 12,
    borderWidth: 1,
    padding: '5%',
    captionAlign: 'center',
  },
  'sports-ticker': {
    variant: 'sports-ticker',
    label: '노래책',
    surface: '#111827',
    text: '#ffffff',
    accent: '#c0392b',
    border: '#ffffff',
    shadow: 'rgba(0, 0, 0, 0.42)',
    radius: 4,
    qrRadius: 2,
    borderWidth: 2,
    padding: '5%',
    captionAlign: 'left',
  },
  'concert-poster': {
    variant: 'concert-poster',
    label: '노래책',
    surface: '#f2d38b',
    text: '#24150d',
    accent: '#d84a24',
    border: '#24150d',
    shadow: 'rgba(0, 0, 0, 0.42)',
    radius: 2,
    qrRadius: 2,
    borderWidth: 2,
    padding: '5%',
    captionAlign: 'left',
  },
};

const THEME_ALIASES: Record<string, QrThemeVariant> = {
  spotify: 'spotify',
  apple: 'apple',
  billboard: 'billboard',
  brutalist: 'brutalist',
  kawaii: 'kawaii',
  glassmorphism: 'glassmorphism',
  'retro-pixel': 'retro-pixel',
  'vinyl-analog': 'vinyl-analog',
  'neon-cyberpunk': 'neon-cyberpunk',
  'hand-drawn': 'hand-drawn',
  'korean-traditional': 'korean-traditional',
  '3d-depth': '3d-depth',
  'sports-ticker': 'sports-ticker',
  'concert-poster': 'concert-poster',
};

function resolveProfile(themeId: string | null | undefined): QrThemeProfile {
  const variant = themeId ? THEME_ALIASES[themeId] : undefined;
  return QR_THEME_PROFILES[variant ?? 'brutalist'];
}

function readStringOption(
  options: Record<string, unknown>,
  keys: readonly string[],
  fallback?: string,
): string | undefined {
  for (const key of keys) {
    const value = options[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return fallback;
}

function readNumberOption(
  options: Record<string, unknown>,
  keys: readonly string[],
  fallback: number,
  min: number,
  max: number,
): number {
  for (const key of keys) {
    const value = options[key];
    const parsed =
      typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
    if (Number.isFinite(parsed)) {
      return Math.max(min, Math.min(max, parsed));
    }
  }
  return fallback;
}

function hexToRgba(color: string, opacity: number): string {
  const trimmed = color.trim();
  const hex = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (!hex) {
    return trimmed;
  }
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((part) => part + part)
          .join('')
      : hex;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, opacity))})`;
}

function withAlpha(color: string, opacity: number): string {
  return hexToRgba(color, opacity);
}

function hexParam(color: string | undefined): string | null {
  const hex = color?.trim().match(/^#([0-9a-f]{6})$/i)?.[1];
  return hex ? hex.toLowerCase() : null;
}

function buildSurface(profile: QrThemeProfile, surface: string, accent: string): string {
  switch (profile.variant) {
    case 'spotify':
      return `linear-gradient(180deg, ${withAlpha(accent, 0.14)}, transparent 38%), ${surface}`;
    case 'apple':
    case 'glassmorphism':
      return `linear-gradient(180deg, rgba(255,255,255,0.34), ${surface})`;
    case '3d-depth':
      return `linear-gradient(145deg, rgba(255,255,255,0.12), ${surface} 34%, #0f172a)`;
    default:
      return surface;
  }
}

function buildShadow(
  profile: QrThemeProfile,
  options: Record<string, unknown>,
  accent: string,
  shadowColor: string,
): string {
  const offset = readNumberOption(
    options,
    ['shadowOffset', 'shadowDepth'],
    profile.variant === 'brutalist' ? 8 : profile.variant === '3d-depth' ? 22 : 14,
    0,
    48,
  );
  const glow = readNumberOption(options, ['glowIntensity'], 0, 0, 40);

  switch (profile.variant) {
    case 'billboard':
    case 'brutalist':
      return offset > 0 ? `${offset}px ${offset}px 0 ${shadowColor}` : 'none';
    case 'retro-pixel':
      return `0 0 0 3px #000, 0 0 ${12 + glow}px ${withAlpha(accent, 0.56)}`;
    case 'neon-cyberpunk':
      return `0 0 ${18 + glow}px ${withAlpha(accent, 0.72)}`;
    case '3d-depth':
      return `0 ${offset}px ${offset * 2}px ${shadowColor}, inset 0 1px 0 rgba(255,255,255,0.18)`;
    default:
      return offset > 0
        ? `0 ${Math.round(offset * 0.7)}px ${Math.round(offset * 1.8)}px ${shadowColor}`
        : 'none';
  }
}

function buildAccentStyle(profile: QrThemeProfile, accent: string): CSSProperties {
  switch (profile.variant) {
    case 'spotify':
      return {
        position: 'absolute',
        left: '6%',
        top: '6%',
        width: '18%',
        height: 4,
        borderRadius: 999,
        background: accent,
      };
    case 'apple':
    case 'glassmorphism':
      return {
        position: 'absolute',
        inset: 0,
        borderRadius: 'inherit',
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.55), inset 0 0 0 1px ${withAlpha(accent, 0.12)}`,
      };
    case 'billboard':
    case 'brutalist':
      return {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: '7%',
        background: accent,
      };
    case 'retro-pixel':
      return {
        position: 'absolute',
        inset: '3%',
        border: `2px solid ${accent}`,
        boxShadow: `0 0 12px ${withAlpha(accent, 0.44)}`,
      };
    case 'kawaii':
      return {
        position: 'absolute',
        right: '7%',
        top: '5%',
        width: '12%',
        aspectRatio: '1 / 1',
        borderRadius: 999,
        background: withAlpha(accent, 0.32),
      };
    case 'vinyl-analog':
      return {
        position: 'absolute',
        inset: '5%',
        borderRadius: 'inherit',
        border: `1px solid ${withAlpha(accent, 0.36)}`,
      };
    case 'neon-cyberpunk':
      return {
        position: 'absolute',
        inset: 0,
        borderRadius: 'inherit',
        boxShadow: `inset 0 0 18px ${withAlpha(accent, 0.22)}`,
      };
    case 'hand-drawn':
      return {
        position: 'absolute',
        inset: '5%',
        borderRadius: 12,
        border: `1px dashed ${withAlpha(accent, 0.46)}`,
      };
    case 'korean-traditional':
      return {
        position: 'absolute',
        right: '7%',
        bottom: '7%',
        width: '10%',
        aspectRatio: '1 / 1',
        border: `2px solid ${accent}`,
      };
    case 'sports-ticker':
      return {
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: '5%',
        background: accent,
      };
    case 'concert-poster':
      return {
        position: 'absolute',
        left: '7%',
        right: '7%',
        top: '7%',
        height: 3,
        background: accent,
      };
    default:
      return {};
  }
}

export function SongbookQrWidget({
  data,
  options,
  fonts,
  themeId,
}: SongbookQrWidgetProps) {
  const supportsCq = useContainerUnitsSupport();
  const themeOptions = options ?? {};
  const common = useCommonOptions(themeOptions);
  const profile = resolveProfile(themeId);
  const songbookUrl = buildSongbookUrl(data);

  const accentColor =
    readStringOption(
      themeOptions,
      ['primaryColor', 'mainColor', 'accentColor', 'accentRed', 'brandColor'],
      common.accentColor,
    ) ?? profile.accent;
  const textColor =
    readStringOption(
      themeOptions,
      ['titleColor', 'textColor', 'inkColor'],
      common.textColor,
    ) ?? profile.text;
  const surfaceColor =
    readStringOption(
      themeOptions,
      [
        'cardBackgroundColor',
        'paperColor',
        'surfaceColor',
        'backgroundColor',
        'cardColor',
        'baseColor',
      ],
      profile.surface,
    ) ?? profile.surface;
  const borderColor =
    readStringOption(themeOptions, ['borderColor'], profile.border) ?? profile.border;
  const shadowColor =
    readStringOption(themeOptions, ['shadowColor'], profile.shadow) ?? profile.shadow;
  const qrBackgroundColor =
    readStringOption(themeOptions, ['qrBackgroundColor'], '#ffffff') ?? '#ffffff';
  const qrForegroundColor =
    readStringOption(themeOptions, ['qrForegroundColor'], '#111111') ?? '#111111';

  const qrParams = new URLSearchParams({
    size: '480x480',
    margin: '14',
    format: 'svg',
    data: songbookUrl,
  });
  const qrForegroundHex = hexParam(qrForegroundColor);
  const qrBackgroundHex = hexParam(qrBackgroundColor);
  if (qrForegroundHex) qrParams.set('color', qrForegroundHex);
  if (qrBackgroundHex) qrParams.set('bgcolor', qrBackgroundHex);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?${qrParams.toString()}`;

  const fontFamily =
    common.fontFamily ??
    buildFontFamilyValue(
      fonts?.roles?.heading ?? fonts?.roles?.body ?? ['Pretendard'],
    );
  const borderWidth = readNumberOption(
    themeOptions,
    ['borderWidth'],
    profile.borderWidth,
    0,
    8,
  );
  const cardRadius = readNumberOption(
    themeOptions,
    ['cardRadius', 'borderRadius'],
    profile.radius,
    0,
    36,
  );
  const qrRadius = readNumberOption(
    themeOptions,
    ['qrBorderRadius'],
    profile.qrRadius,
    0,
    36,
  );
  const label = readStringOption(themeOptions, ['qrLabel'], profile.label) ?? profile.label;

  const rootStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4%',
    boxSizing: 'border-box',
    background: 'transparent',
    pointerEvents: 'none',
    fontFamily,
  };

  const cardStyle: CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    display: 'grid',
    gridTemplateRows: '1fr auto',
    gap: '3%',
    padding: profile.padding,
    boxSizing: 'border-box',
    overflow: 'hidden',
    background: buildSurface(profile, surfaceColor, accentColor),
    border: `${borderWidth}px ${
      profile.variant === 'hand-drawn' ? 'dashed' : 'solid'
    } ${withAlpha(borderColor, common.borderOpacity)}`,
    borderRadius: cardRadius,
    boxShadow: buildShadow(profile, themeOptions, accentColor, shadowColor),
    backdropFilter:
      common.blurIntensity > 0 || profile.variant === 'glassmorphism'
        ? `blur(${Math.max(common.blurIntensity, profile.variant === 'glassmorphism' ? 14 : 0)}px)`
        : undefined,
    WebkitBackdropFilter:
      common.blurIntensity > 0 || profile.variant === 'glassmorphism'
        ? `blur(${Math.max(common.blurIntensity, profile.variant === 'glassmorphism' ? 14 : 0)}px)`
        : undefined,
    transform:
      profile.variant === 'brutalist'
        ? 'rotate(-0.6deg)'
        : profile.variant === 'hand-drawn'
          ? 'rotate(0.4deg)'
          : profile.variant === '3d-depth'
            ? 'perspective(900px) rotateX(2deg) rotateY(-3deg)'
            : undefined,
  };

  const qrFrameStyle: CSSProperties = {
    position: 'relative',
    zIndex: 1,
    minHeight: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding:
      profile.variant === 'retro-pixel' || profile.variant === 'neon-cyberpunk'
        ? '2.5%'
        : '2%',
    boxSizing: 'border-box',
    background:
      profile.variant === 'vinyl-analog'
        ? `radial-gradient(circle, ${withAlpha(accentColor, 0.22)}, transparent 58%)`
        : 'transparent',
    borderRadius: Math.max(0, qrRadius + 6),
  };

  const qrImageStyle: CSSProperties = {
    display: 'block',
    width: '100%',
    height: '100%',
    minWidth: 0,
    minHeight: 0,
    objectFit: 'contain',
    backgroundColor: qrBackgroundColor,
    borderRadius: qrRadius,
    padding: profile.variant === 'retro-pixel' ? '1.5%' : '2%',
    boxSizing: 'border-box',
    imageRendering: profile.variant === 'retro-pixel' ? 'pixelated' : undefined,
    boxShadow:
      profile.variant === 'apple' || profile.variant === 'glassmorphism'
        ? '0 1px 12px rgba(0,0,0,0.12)'
        : undefined,
  };

  const captionStyle: CSSProperties = {
    position: 'relative',
    zIndex: 1,
    minHeight: 0,
    color: textColor,
    fontSize: cqwCap(common.scale(14), 3.7, supportsCq),
    fontWeight: common.fontWeight ?? 700,
    lineHeight: 1,
    textAlign: profile.captionAlign,
    letterSpacing:
      profile.variant === 'retro-pixel' || profile.variant === 'sports-ticker'
        ? 0.8
        : 0,
    textTransform:
      profile.variant === 'retro-pixel' || profile.variant === 'sports-ticker'
        ? 'uppercase'
        : undefined,
    textShadow:
      profile.variant === 'neon-cyberpunk' || profile.variant === 'retro-pixel'
        ? `0 0 8px ${withAlpha(accentColor, 0.72)}`
        : undefined,
  };

  return (
    <div className="h-full w-full" data-songbook-qr-theme={profile.variant}>
      <div style={rootStyle}>
        <div style={cardStyle}>
          <div style={buildAccentStyle(profile, accentColor)} />
          <div style={qrFrameStyle}>
            <img
              src={qrUrl}
              alt="노래책 QR"
              style={qrImageStyle}
              draggable={false}
            />
          </div>
          <div className="truncate" style={captionStyle}>
            {label}
          </div>
        </div>
      </div>
    </div>
  );
}
