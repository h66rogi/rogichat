/**
 * Shared types for the overlay theme manifest.
 *
 * These types are the source of truth for the catalog and are mirrored by:
 *  - meloming-front (Settings UI auto-form generation)
 *  - meloming-overlay (theme component implementations)
 *
 * The backend uses them for validation of `themeId` / `overrides` /
 * `options` payloads in the overlay-theme API.
 */

import type { ThemeAnimationEvent } from './animation-events.js';

// === Option fields (discriminated union) ===

interface BaseOption {
  key: string;
  label: string;
  /** Optional logical group used to render section headings (colors / typography / effects / layout). */
  group?: string;
  helpText?: string;
  /** Defaults to `true` when omitted. */
  required?: boolean;
  /** Conditional visibility — only show this field when `dependsOn.key` equals `dependsOn.value`. */
  dependsOn?: {
    key: string;
    value: unknown;
  };
}

export interface ColorOption extends BaseOption {
  type: 'color';
  default: string;
}

export interface RangeOption extends BaseOption {
  type: 'range';
  default: number;
  min: number;
  max: number;
  step?: number;
  /** Optional unit label displayed alongside the value (e.g. 'px', '%'). */
  unit?: string;
}

export interface SelectOption extends BaseOption {
  type: 'select';
  default: string | number | boolean;
  choices: { value: string | number | boolean; label: string }[];
}

export interface ToggleOption extends BaseOption {
  type: 'toggle';
  default: boolean;
}

export interface FontOption extends BaseOption {
  type: 'font';
  default: string;
}

export interface NumberOption extends BaseOption {
  type: 'number';
  default: number;
  min?: number;
  max?: number;
}

export interface TextOption extends BaseOption {
  type: 'text';
  default: string;
  maxLength?: number;
}

export type OptionField =
  | ColorOption
  | RangeOption
  | SelectOption
  | ToggleOption
  | FontOption
  | NumberOption
  | TextOption;

// === Animation definitions ===

export interface AnimationDef {
  /** Animation identifier. Static keyframes resolve as `{themeId}-{name}`. */
  name: string;
  /** Enter phase duration in milliseconds. */
  enterDuration: number;
  /** Exit phase duration in milliseconds. Defaults to `enterDuration` when omitted. */
  exitDuration?: number;
  /** CSS easing token. Defaults to `ease-out`. */
  easing?: string;
  /** Initial delay in milliseconds. */
  delay?: number;
  /** Per-item delay between consecutive list elements (chat / queue). */
  stagger?: number;
  /** Number of iterations. Defaults to `1`. */
  iterations?: number;
  /** Optional inline @keyframes block injected at runtime (auto-prefixed with themeId). */
  css?: string;
}

// === Fonts ===

export interface FontEntry {
  family: string;
  source: 'google' | 'bundled' | 'system';
  weights: number[];
  /** URL for self-hosted bundled fonts. */
  url?: string;
  /** Supported scripts (latin, korean, emoji, ...). */
  scripts?: string[];
  /**
   * UI에 노출할 표시 이름. 한글 폰트는 정식 한글명, 영문 전용 폰트는 영문
   * 그대로. 누락되면 클라이언트는 `family`로 fallback. 변경해도 CSS family
   * 식별자(`family`)는 영향받지 않으므로 안전하게 추가/수정 가능.
   */
  displayName?: string;
}

export interface ThemeFonts {
  /**
   * Role to fallback chain mapping.
   * Each chain SHOULD include a generic CSS family at the tail
   * (sans-serif, serif, monospace, cursive).
   */
  roles: Record<string, string[]>;
  recommended: FontEntry[];
  bundled: FontEntry[];
}

// === Presets ===

export interface ThemePreset {
  /** Stable identifier with `{themeId}:{slug}` format to avoid collisions across themes. */
  id: string;
  name: string;
  description?: string;
  thumbnail?: string;
  options: Record<string, unknown>;
  /** Marks the preset that should be selected by default in the Settings UI. */
  isDefault?: boolean;
}

// === Subthemes (reserved — previously used by the removed music-genre theme) ===

export interface ThemeSubtheme {
  id: string;
  name: string;
  description: string;
  fonts: ThemeFonts;
  defaultOptions: Record<string, unknown>;
  presets: ThemePreset[];
  animations: Partial<Record<ThemeAnimationEvent, AnimationDef>>;
  cssVariables?: Record<string, string>;
}

// === Performance hints ===

export interface ThemePerformanceHints {
  /** Theme uses backdrop-filter (blur). Browsers without support fall back to opaque backgrounds. */
  usesBackdropFilter?: boolean;
  /** Theme uses 3D transforms (perspective / rotateX / rotateY). */
  uses3DTransform?: boolean;
  /** Theme contains heavy keyframes / particle effects. */
  usesHeavyAnimation?: boolean;
  /** Maximum simultaneous font families. Defaults to `4`. */
  maxFontFamilies?: number;
}

// === Catalog entry (top-level theme metadata) ===

export interface ThemeCatalogEntry {
  id: string;
  name: string;
  /** Filter / search tags (e.g. "retro", "dark", "kawaii"). */
  tags: string[];
  description: string;
  /** Public path to a preview image. */
  thumbnail: string;
  fonts: ThemeFonts;
  /** Schema describing customizable options. Used to auto-generate the Settings UI form. */
  optionSchema: OptionField[];
  /** Default values mirroring `optionSchema` keys. */
  defaultOptions: Record<string, unknown>;
  /** Built-in presets (3-4 per theme). */
  presets: ThemePreset[];
  /** Animation definitions keyed by ThemeAnimationEvent. */
  animations: Partial<Record<ThemeAnimationEvent, AnimationDef>>;
  /** Theme-scoped CSS custom properties. */
  cssVariables?: Record<string, string>;
  /** Optional subthemes (reserved — previously used by the removed `music-genre` theme). */
  subthemes?: ThemeSubtheme[];
  /** Performance hints used by the runtime to apply guardrails / fallbacks. */
  performance?: ThemePerformanceHints;
}
