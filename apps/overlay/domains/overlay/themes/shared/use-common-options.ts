'use client';

import { useEffect, useMemo } from 'react';

import {
  buildFontFamilyValue,
  isGoogleFontFamily,
  loadGoogleFont,
  releaseGoogleFont,
} from './font-loader';

const CUSTOM_FONT_WEIGHTS = [400, 500, 600, 700];

/**
 * Common text/color options that every theme (14 active themes) accepts from
 * the backend. When these fields are present on `options`, widgets should
 * honor them; when absent, widgets fall back to their theme-specific defaults.
 *
 * This helper centralizes fallback handling so each widget only has to wire
 * the return values into its root style / multipliers.
 */
export type TextWeightKey =
  | 'light'
  | 'normal'
  | 'medium'
  | 'semibold'
  | 'bold'
  | 'black';

export interface CommonOptionsInput {
  fontFamily?: string;
  textSize?: number | string; // multiplier (e.g. 1.0, 1.2)
  textWeight?: TextWeightKey | string;
  textColor?: string;
  accentColor?: string;
  backgroundOpacity?: number | string; // 0-100 from backend
  borderOpacity?: number | string;     // 0-100 from backend
  blurIntensity?: number | string;     // 0-40 px from backend
}

export interface ResolvedCommonOptions {
  /** CSS font-family string with safe fallbacks appended. `undefined` if no user override. */
  fontFamily: string | undefined;
  /** 1.0 = unchanged, >1 = bigger, <1 = smaller. Clamped to [0.4, 2.0]. */
  textSizeMultiplier: number;
  /** Numeric font-weight value (400..900). `undefined` if no user override. */
  fontWeight: number | undefined;
  /** Primary body text color. `undefined` if no user override. */
  textColor: string | undefined;
  /** Accent color (highlights, progress bar, link color, etc.). `undefined` if no user override. */
  accentColor: string | undefined;
  /** Background opacity as a 0-1 float (input 0-100 divided by 100). */
  backgroundOpacity: number;
  /** Border opacity as a 0-1 float (input 0-100 divided by 100). */
  borderOpacity: number;
  /** Blur intensity in px (0-40). */
  blurIntensity: number;
  /** Multiply a px size by this to honor `textSize`. */
  scale: (px: number) => number;
}

const WEIGHT_MAP: Record<string, number> = {
  light: 300,
  normal: 400,
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  black: 900,
};

function toWeight(input: unknown): number | undefined {
  if (input == null) return undefined;
  if (typeof input === 'number' && Number.isFinite(input)) {
    return Math.max(100, Math.min(900, Math.round(input)));
  }
  if (typeof input === 'string') {
    const lower = input.trim().toLowerCase();
    if (lower in WEIGHT_MAP) return WEIGHT_MAP[lower];
    const parsed = Number.parseInt(lower, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(100, Math.min(900, parsed));
    }
  }
  return undefined;
}

function toOpacity(input: unknown, fallback: number = 1): number {
  if (input == null) return fallback;
  const n = typeof input === 'number' ? input : Number.parseFloat(String(input));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n / 100));
}

function toBlurIntensity(input: unknown): number {
  if (input == null) return 0;
  const n = typeof input === 'number' ? input : Number.parseFloat(String(input));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(40, n));
}

function toMultiplier(input: unknown): number {
  if (input == null) return 1;
  const n = typeof input === 'number' ? input : Number.parseFloat(String(input));
  if (!Number.isFinite(n)) return 1;
  return Math.max(0.4, Math.min(2.0, n));
}

function toFontFamily(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  const stripped = trimmed.replace(/^["']|["']$/g, '');
  if (!stripped) return undefined;
  if (stripped.includes(',')) {
    const families = stripped
      .split(',')
      .map((f) => f.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
    return buildFontFamilyValue(families);
  }
  return buildFontFamilyValue([stripped]);
}

/**
 * Resolve the 5 common options (fontFamily / textSize / textWeight / textColor
 * / accentColor) off a theme options record. Returns fallbacks (undefined /
 * 1.0) when a field is missing so callers can still apply theme defaults.
 *
 * Also triggers a lazy local font CSS `<link>` injection for the user-picked
 * `fontFamily` — without this the picker would save a family that isn't in
 * the theme's `recommended` list and the browser would silently fall through
 * the CSS fallback chain (= font change appears to do nothing).
 */
export function useCommonOptions(
  options: Record<string, unknown> | null | undefined,
): ResolvedCommonOptions {
  const resolved = useMemo(() => {
    const opts = (options ?? {}) as CommonOptionsInput;
    const fontFamily = toFontFamily(opts.fontFamily);
    const rawFontFamily = (() => {
      if (typeof opts.fontFamily !== 'string') return '';
      const t = opts.fontFamily.trim().replace(/^["']|["']$/g, '');
      if (!t) return '';
      if (!t.includes(',')) return t;
      return t.split(',')[0].trim().replace(/^["']|["']$/g, '') || '';
    })();
    const fontWeight = toWeight(opts.textWeight);
    const textSizeMultiplier = toMultiplier(opts.textSize);
    const textColor =
      typeof opts.textColor === 'string' && opts.textColor
        ? opts.textColor
        : undefined;
    const accentColor =
      typeof opts.accentColor === 'string' && opts.accentColor
        ? opts.accentColor
        : undefined;
    const scale = (px: number) => Math.round(px * textSizeMultiplier);
    return {
      fontFamily,
      rawFontFamily,
      textSizeMultiplier,
      fontWeight,
      textColor,
      accentColor,
      backgroundOpacity: toOpacity(opts.backgroundOpacity),
      borderOpacity: toOpacity(opts.borderOpacity),
      blurIntensity: toBlurIntensity(opts.blurIntensity),
      scale,
    };
  }, [options]);

  // Side effect: inject a self-hosted font CSS `<link>` for the user-picked family.
  // `loadGoogleFont`는 acquire 1회 → cleanup에서 releaseGoogleFont로 1회
  // decrement. 성공적으로 로드된 stylesheet는 세션 동안 유지되지만, ref count는
  // pending load 취소와 중복 acquire 정합성을 지키는 데 필요하다.
  //
  // Local Google mirror에 등록된 family에만 호출 — bundled / overlay.css
  // 사전 @font-face 폰트는 이미 로드되어 있어 동적 호출이 redundant임
  // (Pretendard/NanumSquare Neo/CookieRun 등).
  useEffect(() => {
    const family = resolved.rawFontFamily;
    if (!family) return;
    if (!isGoogleFontFamily(family)) return;
    void loadGoogleFont(family, CUSTOM_FONT_WEIGHTS);
    return () => {
      releaseGoogleFont(family, CUSTOM_FONT_WEIGHTS);
    };
  }, [resolved.rawFontFamily]);

  return resolved;
}
