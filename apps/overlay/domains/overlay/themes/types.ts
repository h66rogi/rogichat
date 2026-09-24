import type { ComponentType } from 'react';
import type { OverlayData } from '../types';
import type { OverlayChatEvent } from '../types/chat';
import type { PlaybackProgress } from '../components/now-playing/types';

// === Connection status (matches useOverlaySocket return) ===
export type OverlayConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting';

// === Widget types ===
export const WIDGET_TYPES = [
  'now-playing',
  'queue',
  'chatbox',
  'setlist',
  'lyrics',
  'songbook-qr',
] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

export function isValidWidgetType(value: string): value is WidgetType {
  return (WIDGET_TYPES as readonly string[]).includes(value);
}

// === Theme IDs ===
export const THEME_IDS = [
  'apple',
  'spotify',
  'billboard',
  'retro-pixel',
  'glassmorphism',
  'brutalist',
  'kawaii',
  'vinyl-analog',
  'neon-cyberpunk',
  'hand-drawn',
  'korean-traditional',
  '3d-depth',
  'sports-ticker',
  'concert-poster',
] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export type AnyThemeId = ThemeId;

export const ALL_THEME_IDS: readonly AnyThemeId[] = [...THEME_IDS];

export function isValidThemeId(value: string): value is AnyThemeId {
  return (ALL_THEME_IDS as readonly string[]).includes(value);
}

// === Animation events ===
export const REQUIRED_ANIMATION_EVENTS = [
  'track.change', 'chat.enter', 'queue.add', 'donation',
] as const;
export const OPTIONAL_ANIMATION_EVENTS = ['chat.exit', 'queue.remove'] as const;

export type RequiredAnimationEvent = (typeof REQUIRED_ANIMATION_EVENTS)[number];
export type OptionalAnimationEvent = (typeof OPTIONAL_ANIMATION_EVENTS)[number];
export type ThemeAnimationEvent = RequiredAnimationEvent | OptionalAnimationEvent;

// === Animation definition ===
export interface AnimationDef {
  name: string;
  enterDuration: number;
  exitDuration?: number;
  easing?: string;
  delay?: number;
  stagger?: number;
  iterations?: number;
  css?: string;
}

// === Font ===
export interface FontEntry {
  family: string;
  source: 'google' | 'bundled' | 'system';
  weights: number[];
  url?: string;
  scripts?: string[];
}

export interface ThemeFonts {
  roles: Record<string, string[]>;
  recommended: FontEntry[];
  bundled: FontEntry[];
}

// === Option Field (discriminated union) ===
interface BaseOption {
  key: string;
  label: string;
  group?: string;
  helpText?: string;
  required?: boolean;
  dependsOn?: { key: string; value: unknown };
}

export interface ColorOption extends BaseOption { type: 'color'; default: string; }
export interface RangeOption extends BaseOption {
  type: 'range'; default: number; min: number; max: number; step?: number;
}
export interface SelectOption extends BaseOption {
  type: 'select'; default: string | number | boolean;
  choices: { value: string | number | boolean; label: string }[];
}
export interface ToggleOption extends BaseOption { type: 'toggle'; default: boolean; }
export interface FontOption extends BaseOption { type: 'font'; default: string; }
export interface NumberOption extends BaseOption {
  type: 'number'; default: number; min?: number; max?: number;
}
export interface TextOption extends BaseOption {
  type: 'text'; default: string; maxLength?: number;
}

export type OptionField =
  | ColorOption | RangeOption | SelectOption | ToggleOption
  | FontOption | NumberOption | TextOption;

// === Preset ===
export interface ThemePreset<TOptions = Record<string, unknown>> {
  id: string;
  name: string;
  description?: string;
  thumbnail?: string;
  options: TOptions;
  isDefault?: boolean;
}

// === Performance hints ===
export interface ThemePerformanceHints {
  usesBackdropFilter?: boolean;
  uses3DTransform?: boolean;
  usesHeavyAnimation?: boolean;
  maxFontFamilies?: number;
}

// === Theme widget props (passed to all theme widget components) ===
export interface ThemeWidgetProps<TOptions = Record<string, unknown>> {
  data: OverlayData;
  options: TOptions;
  animations: Partial<Record<ThemeAnimationEvent, AnimationDef>>;
  fonts: ThemeFonts;
  reducedMotion: boolean;
  /** Live chat messages (only relevant for chatbox widget). Empty array for non-chat widgets. */
  chatMessages?: OverlayChatEvent[];
  /** WebSocket connection status (used by widgets to show offline indicator). */
  connectionStatus?: OverlayConnectionStatus;
  /** Real-time playback progress from server (only relevant for now-playing widget). */
  playbackProgress?: PlaybackProgress;
}

// === Theme Definition ===
export interface ThemeDefinition<TOptions extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  name: string;
  tags: string[];
  description: string;
  thumbnail: string;

  widgets: Partial<Record<WidgetType, ComponentType<ThemeWidgetProps<TOptions>>>>;
  fonts: ThemeFonts;

  optionSchema: OptionField[];
  defaultOptions: TOptions;
  presets: ThemePreset<TOptions>[];

  animations: Partial<Record<ThemeAnimationEvent, AnimationDef>>;
  cssVariables?: Record<string, string>;
  performance?: ThemePerformanceHints;
}

// === Default fallback animation ===
export const DEFAULT_FALLBACK_ANIMATION: AnimationDef = {
  name: 'fade',
  enterDuration: 300,
  exitDuration: 200,
  easing: 'ease-out',
};
