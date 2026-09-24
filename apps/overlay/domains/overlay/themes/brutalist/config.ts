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
export interface BrutalistOptions extends Record<string, unknown> {
  borderWidth: number;
  shadowOffset: number;
  accentColor: string;
  dangerColor: string;
  tiltAngle: number;
  backgroundColor: string;
}

// === Default option values ===
export const defaultOptions: BrutalistOptions = {
  borderWidth: 5,
  shadowOffset: 10,
  accentColor: '#ffff00',
  dangerColor: '#ff0000',
  tiltAngle: -1,
  backgroundColor: '#f5f5dc',
};

// === Option schema (UI form) ===
export const optionSchema: OptionField[] = [
  {
    key: 'borderWidth',
    type: 'range',
    default: defaultOptions.borderWidth,
    min: 2,
    max: 8,
    label: 'Border width (px)',
    group: 'layout',
  },
  {
    key: 'shadowOffset',
    type: 'range',
    default: defaultOptions.shadowOffset,
    min: 4,
    max: 16,
    label: 'Shadow offset (px)',
    group: 'effects',
  },
  {
    key: 'accentColor',
    type: 'color',
    default: defaultOptions.accentColor,
    label: 'Accent color',
    group: 'colors',
  },
  {
    key: 'dangerColor',
    type: 'color',
    default: defaultOptions.dangerColor,
    label: 'Danger / LIVE color',
    group: 'colors',
  },
  {
    key: 'tiltAngle',
    type: 'range',
    default: defaultOptions.tiltAngle,
    min: -5,
    max: 5,
    step: 0.5,
    label: 'Tilt angle (deg)',
    group: 'layout',
  },
  {
    key: 'backgroundColor',
    type: 'color',
    default: defaultOptions.backgroundColor,
    label: 'Background',
    group: 'colors',
  },
];

// === Presets ===
export const presets: ThemePreset<BrutalistOptions>[] = [
  {
    id: 'brutalist:black-white',
    name: 'Black & White',
    description: '클래식 브루탈리즘. 흑백 + 노란색 포인트.',
    options: {
      borderWidth: 5,
      shadowOffset: 10,
      accentColor: '#ffff00',
      dangerColor: '#ff0000',
      tiltAngle: -1,
      backgroundColor: '#f5f5dc',
    },
    isDefault: true,
  },
  {
    id: 'brutalist:danger-red',
    name: 'Danger Red',
    description: '강렬한 빨강 경고 팔레트. 화이트 배경.',
    options: {
      borderWidth: 5,
      shadowOffset: 10,
      accentColor: '#ff0000',
      dangerColor: '#ff0000',
      tiltAngle: -1,
      backgroundColor: '#ffffff',
    },
  },
  {
    id: 'brutalist:electric-yellow',
    name: 'Electric Yellow',
    description: '형광 노랑 배경 + 블랙 포인트. 최대 대비.',
    options: {
      borderWidth: 5,
      shadowOffset: 10,
      accentColor: '#000000',
      dangerColor: '#ff0000',
      tiltAngle: -1,
      backgroundColor: '#ffff00',
    },
  },
];

// === Fonts ===
const recommendedFonts: FontEntry[] = [
  {
    family: 'Inter',
    source: 'google',
    weights: [400, 700, 900],
    scripts: ['latin'],
  },
];

export const fonts: ThemeFonts = {
  roles: {
    heading: ['Inter', 'Arial Black', 'Helvetica Bold', 'sans-serif'],
    body: ['Inter', 'NanumSquare Neo', 'Arial', 'sans-serif'],
  },
  recommended: recommendedFonts,
  bundled: [],
};

// === Animations ===
// Animation `name` is auto-namespaced to `brutalist-{name}` by the theme
// system. The static keyframes in animations.css use the namespaced form.
export const animations: Partial<Record<ThemeAnimationEvent, AnimationDef>> = {
  'track.change': {
    name: 'hardcut',
    enterDuration: 50,
  },
  'chat.enter': {
    name: 'stamp',
    enterDuration: 250,
    stagger: 30,
  },
  'chat.exit': {
    name: 'disappear',
    enterDuration: 100,
  },
  'queue.add': {
    name: 'slap-in',
    enterDuration: 200,
    stagger: 40,
  },
  'queue.remove': {
    name: 'slap-out',
    enterDuration: 150,
  },
  donation: {
    name: 'screen-flash',
    enterDuration: 400,
    iterations: 1,
  },
};

// === Performance hints ===
export const performance: ThemePerformanceHints = {
  maxFontFamilies: 1,
};

// === CSS variables (consumed by widget components) ===
export const cssVariables: Record<string, string> = {
  '--brutalist-accent': defaultOptions.accentColor,
  '--brutalist-danger': defaultOptions.dangerColor,
  '--brutalist-bg': defaultOptions.backgroundColor,
};

const config = {
  optionSchema,
  defaultOptions,
  presets,
  fonts,
  animations,
  performance,
  cssVariables,
};

export default config;
