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
export interface KawaiiOptions extends Record<string, unknown> {
  mainColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  decorationStyle: 'stars' | 'hearts' | 'sparkles';
  borderRadius: number;
}

// === Default option values ===
export const defaultOptions: KawaiiOptions = {
  mainColor: '#ffb6d9',
  accentColor: '#b088f9',
  backgroundColor: '#fff5fa',
  textColor: '#d63384',
  decorationStyle: 'stars',
  borderRadius: 20,
};

// === Option schema (UI form) ===
export const optionSchema: OptionField[] = [
  {
    key: 'mainColor',
    type: 'color',
    default: defaultOptions.mainColor,
    label: 'Main pastel color',
    group: 'colors',
  },
  {
    key: 'accentColor',
    type: 'color',
    default: defaultOptions.accentColor,
    label: 'Accent color',
    group: 'colors',
  },
  {
    key: 'backgroundColor',
    type: 'color',
    default: defaultOptions.backgroundColor,
    label: 'Background',
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
    key: 'decorationStyle',
    type: 'select',
    default: defaultOptions.decorationStyle,
    label: 'Decoration style',
    group: 'effects',
    choices: [
      { value: 'stars', label: 'Stars' },
      { value: 'hearts', label: 'Hearts' },
      { value: 'sparkles', label: 'Sparkles' },
    ],
  },
  {
    key: 'borderRadius',
    type: 'range',
    default: defaultOptions.borderRadius,
    min: 8,
    max: 32,
    label: 'Border radius (px)',
    group: 'layout',
  },
];

// === Presets ===
export const presets: ThemePreset<KawaiiOptions>[] = [
  {
    id: 'kawaii:cherry-blossom',
    name: 'Cherry Blossom',
    description: '봄날의 벚꽃처럼 부드러운 파스텔 핑크와 라벤더.',
    options: {
      mainColor: '#ffb6d9',
      accentColor: '#b088f9',
      backgroundColor: '#fff5fa',
      textColor: '#d63384',
      decorationStyle: 'stars',
      borderRadius: 20,
    },
    isDefault: true,
  },
  {
    id: 'kawaii:lavender-dream',
    name: 'Lavender Dream',
    description: '몽환적인 라벤더 팔레트. 보라보라 드림팝.',
    options: {
      mainColor: '#c8a2ff',
      accentColor: '#ffb6d9',
      backgroundColor: '#f5f0ff',
      textColor: '#8b5cf6',
      decorationStyle: 'hearts',
      borderRadius: 20,
    },
  },
  {
    id: 'kawaii:mint-choco',
    name: 'Mint Choco',
    description: '상큼한 민트-스카이 조합. 시원한 여름 톤.',
    options: {
      mainColor: '#88d3f9',
      accentColor: '#5dd6c8',
      backgroundColor: '#f0fff8',
      textColor: '#0ea5e9',
      decorationStyle: 'sparkles',
      borderRadius: 20,
    },
  },
  {
    id: 'kawaii:sunset-peach',
    name: 'Sunset Peach',
    description: '복숭아빛 노을. 따뜻한 피치-옐로우 조합.',
    options: {
      mainColor: '#ffaa88',
      accentColor: '#ffd166',
      backgroundColor: '#fff5e6',
      textColor: '#e76f51',
      decorationStyle: 'stars',
      borderRadius: 20,
    },
  },
];

// === Fonts ===
const recommendedFonts: FontEntry[] = [
  {
    family: 'Fredoka',
    source: 'google',
    weights: [400, 600, 700],
    scripts: ['latin'],
  },
  {
    family: 'Comfortaa',
    source: 'google',
    weights: [400, 700],
    scripts: ['latin'],
  },
];

export const fonts: ThemeFonts = {
  roles: {
    heading: ['Fredoka', 'Comfortaa', 'CookieRun', 'sans-serif'],
    body: ['Comfortaa', 'Fredoka', 'NanumSquare Neo', 'Pretendard', 'sans-serif'],
  },
  recommended: recommendedFonts,
  bundled: [],
};

// === Animations ===
// Animation `name` is auto-namespaced to `kawaii-{name}` by the theme
// system. The static keyframes in animations.css use the namespaced form.
export const animations: Partial<Record<ThemeAnimationEvent, AnimationDef>> = {
  'track.change': {
    name: 'bounce-in',
    enterDuration: 500,
    exitDuration: 200,
  },
  'chat.enter': {
    name: 'pop-bounce',
    enterDuration: 400,
    stagger: 50,
  },
  'chat.exit': {
    name: 'shrink-fade',
    enterDuration: 200,
  },
  'queue.add': {
    name: 'heart-slide',
    enterDuration: 450,
    stagger: 80,
  },
  'queue.remove': {
    name: 'fly-away',
    enterDuration: 300,
  },
  donation: {
    name: 'star-burst',
    enterDuration: 1000,
    iterations: 1,
  },
};

// === Performance hints ===
export const performance: ThemePerformanceHints = {
  usesHeavyAnimation: true,
  maxFontFamilies: 2,
};

// === CSS variables (consumed by widget components) ===
export const cssVariables: Record<string, string> = {
  '--kawaii-main': defaultOptions.mainColor,
  '--kawaii-accent': defaultOptions.accentColor,
  '--kawaii-bg': defaultOptions.backgroundColor,
  '--kawaii-text': defaultOptions.textColor,
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
