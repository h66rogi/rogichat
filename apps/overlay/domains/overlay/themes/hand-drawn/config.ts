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
export interface HandDrawnOptions extends Record<string, unknown> {
  paperColor: string;
  inkColor: string;
  accentColor: string;
  highlightColor: string;
  borderRoughness: number;
  tiltMax: number;
  showTape: boolean;
}

// === Default option values ===
export const defaultOptions: HandDrawnOptions = {
  paperColor: '#faf5eb',
  inkColor: '#2c2c2c',
  accentColor: '#ff6b6b',
  highlightColor: '#ffeb3b',
  borderRoughness: 2,
  tiltMax: 2,
  showTape: true,
};

// === Option schema (UI form) ===
export const optionSchema: OptionField[] = [
  {
    key: 'paperColor',
    type: 'color',
    default: defaultOptions.paperColor,
    label: 'Paper color',
    group: 'colors',
  },
  {
    key: 'inkColor',
    type: 'color',
    default: defaultOptions.inkColor,
    label: 'Ink color',
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
    key: 'highlightColor',
    type: 'color',
    default: defaultOptions.highlightColor,
    label: 'Highlighter color',
    group: 'colors',
  },
  {
    key: 'borderRoughness',
    type: 'range',
    default: defaultOptions.borderRoughness,
    min: 1,
    max: 4,
    label: 'Border roughness',
    group: 'effects',
  },
  {
    key: 'tiltMax',
    type: 'range',
    default: defaultOptions.tiltMax,
    min: 0,
    max: 5,
    step: 0.5,
    label: 'Maximum tilt (deg)',
    group: 'layout',
  },
  {
    key: 'showTape',
    type: 'toggle',
    default: defaultOptions.showTape,
    label: 'Show tape decoration',
    group: 'effects',
  },
];

// === Presets ===
export const presets: ThemePreset<HandDrawnOptions>[] = [
  {
    id: 'hand-drawn:notebook',
    name: 'Notebook',
    description: '크라프트 베이지 종이에 검정 잉크. 따뜻한 노트북 무드.',
    options: {
      paperColor: '#faf5eb',
      inkColor: '#2c2c2c',
      accentColor: '#ff6b6b',
      highlightColor: '#ffeb3b',
      borderRoughness: 2,
      tiltMax: 2,
      showTape: true,
    },
    isDefault: true,
  },
  {
    id: 'hand-drawn:sketchpad',
    name: 'Sketchpad',
    description: '회색빛 스케치북에 진한 흑연. 차가운 블루 액센트.',
    options: {
      paperColor: '#f0f0e8',
      inkColor: '#1a1a1a',
      accentColor: '#2196f3',
      highlightColor: '#ffeb3b',
      borderRoughness: 2,
      tiltMax: 2,
      showTape: true,
    },
  },
  {
    id: 'hand-drawn:diary',
    name: 'Diary',
    description: '핑크 다이어리. 갈색 잉크와 핑크 액센트.',
    options: {
      paperColor: '#fff5f0',
      inkColor: '#4a3c2a',
      accentColor: '#d63384',
      highlightColor: '#ffeb3b',
      borderRoughness: 2,
      tiltMax: 2,
      showTape: true,
    },
  },
  {
    id: 'hand-drawn:craft-paper',
    name: 'Craft Paper',
    description: '거친 크라프트 종이. 짙은 갈색 잉크.',
    options: {
      paperColor: '#d4b896',
      inkColor: '#3a2810',
      accentColor: '#8b4513',
      highlightColor: '#ffeb3b',
      borderRoughness: 2,
      tiltMax: 2,
      showTape: true,
    },
  },
];

// === Fonts ===
const recommendedFonts: FontEntry[] = [
  {
    family: 'Caveat',
    source: 'google',
    weights: [400, 700],
    scripts: ['latin'],
  },
  {
    family: 'Patrick Hand',
    source: 'google',
    weights: [400],
    scripts: ['latin'],
  },
  {
    family: 'Nanum Pen Script',
    source: 'google',
    weights: [400],
    scripts: ['korean'],
  },
];

export const fonts: ThemeFonts = {
  roles: {
    heading: ['Caveat', 'Patrick Hand', 'cursive'],
    body: ['Patrick Hand', 'Caveat', 'sans-serif'],
    accent: ['Caveat', 'cursive'],
  },
  recommended: recommendedFonts,
  bundled: [],
};

// === Animations ===
// Animation `name` is auto-namespaced to `hand-drawn-{name}` by the theme
// system. The static keyframes in animations.css use the namespaced form.
export const animations: Partial<Record<ThemeAnimationEvent, AnimationDef>> = {
  'track.change': {
    name: 'page-flip',
    enterDuration: 600,
    exitDuration: 300,
    easing: 'cubic-bezier(0.4, 0.0, 0.2, 1)',
  },
  'chat.enter': {
    name: 'pencil-draw',
    enterDuration: 400,
    stagger: 60,
    easing: 'ease-out',
  },
  'chat.exit': {
    name: 'eraser-fade',
    enterDuration: 300,
    easing: 'ease-in',
  },
  'queue.add': {
    name: 'sticker-stick',
    enterDuration: 450,
    stagger: 80,
    easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
  'queue.remove': {
    name: 'sticker-peel',
    enterDuration: 300,
    easing: 'ease-in',
  },
  donation: {
    name: 'highlight-stamp',
    enterDuration: 800,
    iterations: 1,
    easing: 'ease-in-out',
  },
};

// === Performance hints ===
export const performance: ThemePerformanceHints = {
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
