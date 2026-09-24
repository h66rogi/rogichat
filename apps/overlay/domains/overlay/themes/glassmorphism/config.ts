import type {
  AnimationDef,
  FontEntry,
  OptionField,
  ThemeAnimationEvent,
  ThemeFonts,
  ThemePerformanceHints,
  ThemePreset,
} from '../types';

// === Theme options ===
export interface GlassmorphismOptions extends Record<string, unknown> {
  gradientStart: string;
  gradientEnd: string;
  cardOpacity: number;
  textColor: string;
  /** iOS-26 Liquid Glass base opacity (0.1 – 0.6). */
  glassOpacity: number;
  /** iOS-26 Liquid Glass backdrop blur in px (8 – 40). */
  glassBlur: number;
}

// === Default option values ===
// glassOpacity/glassBlur bumped from 0.28/20 so the Liquid Glass refraction
// and specular highlights are visible over any backdrop (including light
// album art where prior defaults made text nearly invisible).
export const defaultOptions: GlassmorphismOptions = {
  gradientStart: '#667eea',
  gradientEnd: '#764ba2',
  cardOpacity: 12,
  textColor: '#ffffff',
  glassOpacity: 0.48,
  glassBlur: 32,
};

// === Option schema (UI form) ===
export const optionSchema: OptionField[] = [
  {
    key: 'gradientStart',
    type: 'color',
    default: defaultOptions.gradientStart,
    label: 'Gradient start',
    group: 'colors',
  },
  {
    key: 'gradientEnd',
    type: 'color',
    default: defaultOptions.gradientEnd,
    label: 'Gradient end',
    group: 'colors',
  },
  {
    key: 'cardOpacity',
    type: 'range',
    default: defaultOptions.cardOpacity,
    min: 0,
    max: 100,
    step: 1,
    label: 'Card opacity %',
    group: 'colors',
  },
  {
    key: 'textColor',
    type: 'color',
    default: defaultOptions.textColor,
    label: 'Text color',
    group: 'colors',
  },
  {
    key: 'glassOpacity',
    type: 'range',
    default: defaultOptions.glassOpacity,
    min: 0.1,
    max: 0.6,
    step: 0.01,
    label: 'Liquid glass base opacity',
    group: 'effects',
  },
  {
    key: 'glassBlur',
    type: 'range',
    default: defaultOptions.glassBlur,
    min: 8,
    max: 40,
    step: 1,
    label: 'Liquid glass backdrop blur (px)',
    group: 'effects',
  },
];

// === Presets ===
// glass{Opacity,Blur} 값은 Apple iOS 26 Liquid Glass 강화 디폴트(0.48/32) 기준.
// 백엔드 catalog presets와 항상 동기 유지 — 차이 나면 사용자가 같은 프리셋을
// 적용했을 때 화면이 다르게 보임.
export const presets: ThemePreset<GlassmorphismOptions>[] = [
  {
    id: 'glassmorphism:purple-haze',
    name: 'Purple Haze',
    description: '보라 그라데이션 위의 리퀴드 글래스. 기본 프리셋 (강화됨).',
    options: {
      gradientStart: '#667eea',
      gradientEnd: '#764ba2',
      cardOpacity: 12,
      textColor: '#ffffff',
      glassOpacity: 0.48,
      glassBlur: 32,
    },
    isDefault: true,
  },
  {
    id: 'glassmorphism:ocean-breeze',
    name: 'Ocean Breeze',
    description: '시원한 바다 그라데이션 위의 가벼운 리퀴드 글래스.',
    options: {
      gradientStart: '#4facfe',
      gradientEnd: '#00f2fe',
      cardOpacity: 14,
      textColor: '#ffffff',
      glassOpacity: 0.42,
      glassBlur: 30,
    },
  },
  {
    id: 'glassmorphism:midnight-blue',
    name: 'Midnight Blue',
    description: '깊은 밤하늘 톤의 다크 리퀴드 글래스.',
    options: {
      gradientStart: '#1e3a8a',
      gradientEnd: '#0c1a40',
      cardOpacity: 16,
      textColor: '#e6efff',
      glassOpacity: 0.52,
      glassBlur: 34,
    },
  },
  {
    id: 'glassmorphism:rose-gold',
    name: 'Rose Gold',
    description: '핑크-골드 선셋 리퀴드 글래스.',
    options: {
      gradientStart: '#fa709a',
      gradientEnd: '#fee140',
      cardOpacity: 14,
      textColor: '#ffffff',
      glassOpacity: 0.44,
      glassBlur: 30,
    },
  },
];

// === Fonts ===
const recommendedFonts: FontEntry[] = [
  {
    family: 'Inter',
    source: 'google',
    weights: [400, 500, 700],
    scripts: ['latin'],
  },
];

export const fonts: ThemeFonts = {
  roles: {
    heading: ['Inter', 'NanumSquare Neo', 'Pretendard', 'system-ui', 'sans-serif'],
    body: ['NanumSquare Neo', 'Pretendard', 'Inter', 'sans-serif'],
    accent: ['Inter', 'monospace'],
  },
  recommended: recommendedFonts,
  bundled: [],
};

// === Animations ===
// Animation `name` is auto-namespaced to `glassmorphism-{name}` by the theme
// system. The static keyframes in animations.css use the namespaced form.
export const animations: Partial<Record<ThemeAnimationEvent, AnimationDef>> = {
  'track.change': {
    name: 'glass-blur-fade',
    enterDuration: 500,
    exitDuration: 250,
    easing: 'ease-in-out',
  },
  'chat.enter': {
    name: 'glass-slide-in',
    enterDuration: 350,
    stagger: 60,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  },
  'chat.exit': {
    name: 'glass-fade-out',
    enterDuration: 200,
    easing: 'ease-out',
  },
  'queue.add': {
    name: 'glass-soft-drop',
    enterDuration: 400,
    stagger: 80,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  },
  'queue.remove': {
    name: 'glass-fade-out',
    enterDuration: 250,
    easing: 'ease-out',
  },
  donation: {
    name: 'glass-glow-pulse',
    enterDuration: 800,
    iterations: 1,
    easing: 'ease-in-out',
  },
};

// === Performance hints ===
export const performance: ThemePerformanceHints = {
  usesBackdropFilter: true,
  maxFontFamilies: 2,
};

const config = {
  optionSchema,
  defaultOptions,
  presets,
  fonts,
  animations,
  performance,
};

export default config;
