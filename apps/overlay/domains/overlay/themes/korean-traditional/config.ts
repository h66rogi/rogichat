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
export interface KoreanTraditionalOptions extends Record<string, unknown> {
  baseColor: string;
  inkColor: string;
  accentRed: string;
  accentBrown: string;
  patternStyle: 'minimal' | 'border' | 'corner';
  showStamp: boolean;
  stampText: string;
}

// === Default option values ===
// 한지(hanji) baseline — warm cream paper, ink black, dancheong red & brown.
export const defaultOptions: KoreanTraditionalOptions = {
  baseColor: '#f5f0e1', // 한지색 — warm hanji paper
  inkColor: '#2c1810', // 먹색 — dark sumi ink
  accentRed: '#c0392b', // 단청 적색 — dancheong red
  accentBrown: '#8b5a2b', // 적갈색 — reddish brown
  patternStyle: 'border',
  showStamp: true,
  stampText: '명곡',
};

// === Option schema (UI form) ===
export const optionSchema: OptionField[] = [
  {
    key: 'baseColor',
    type: 'color',
    default: defaultOptions.baseColor,
    label: 'Base color (한지색)',
    group: 'colors',
  },
  {
    key: 'inkColor',
    type: 'color',
    default: defaultOptions.inkColor,
    label: 'Ink color (먹색)',
    group: 'colors',
  },
  {
    key: 'accentRed',
    type: 'color',
    default: defaultOptions.accentRed,
    label: 'Accent red (단청 적색)',
    group: 'colors',
  },
  {
    key: 'accentBrown',
    type: 'color',
    default: defaultOptions.accentBrown,
    label: 'Accent brown (적갈색)',
    group: 'colors',
  },
  {
    key: 'patternStyle',
    type: 'select',
    default: defaultOptions.patternStyle,
    label: 'Pattern style',
    group: 'effects',
    choices: [
      { value: 'minimal', label: 'Minimal' },
      { value: 'border', label: 'Border pattern' },
      { value: 'corner', label: 'Corner motif' },
    ],
  },
  {
    key: 'showStamp',
    type: 'toggle',
    default: defaultOptions.showStamp,
    label: 'Show stamp (도장)',
    group: 'effects',
  },
  {
    key: 'stampText',
    type: 'text',
    default: defaultOptions.stampText,
    label: 'Stamp text',
    group: 'effects',
    maxLength: 4,
  },
];

// === Presets ===
export const presets: ThemePreset<KoreanTraditionalOptions>[] = [
  {
    id: 'korean-traditional:hanji-classic',
    name: 'Hanji Classic',
    description: '한지 종이의 따뜻한 베이지와 먹색의 조합. 가장 정통적인 한국 전통 미감.',
    options: {
      baseColor: '#f5f0e1',
      inkColor: '#2c1810',
      accentRed: '#c0392b',
      accentBrown: '#8b5a2b',
      patternStyle: 'border',
      showStamp: true,
      stampText: '명곡',
    },
    isDefault: true,
  },
  {
    id: 'korean-traditional:dancheong',
    name: 'Dancheong',
    description: '단청에서 영감을 받은 진한 적색과 크림빛 배경.',
    options: {
      baseColor: '#fff8e7',
      inkColor: '#2c1810',
      accentRed: '#9c1f1f',
      accentBrown: '#8b5a2b',
      patternStyle: 'border',
      showStamp: true,
      stampText: '단청',
    },
  },
  {
    id: 'korean-traditional:ink-brush',
    name: 'Ink Brush',
    description: '서예지처럼 다소 누르스름한 종이에 짙은 먹.',
    options: {
      baseColor: '#f0e8d0',
      inkColor: '#000000',
      accentRed: '#c0392b',
      accentBrown: '#8b5a2b',
      patternStyle: 'border',
      showStamp: true,
      stampText: '서예',
    },
  },
  {
    id: 'korean-traditional:modern-hanok',
    name: 'Modern Hanok',
    description: '현대적인 한옥 인테리어 무드 — 깨끗한 화이트와 절제된 적색.',
    options: {
      baseColor: '#fafafa',
      inkColor: '#1a1a1a',
      accentRed: '#c4302b',
      accentBrown: '#8b5a2b',
      patternStyle: 'border',
      showStamp: true,
      stampText: '한옥',
    },
  },
];

// === Fonts ===
const recommendedFonts: FontEntry[] = [
  {
    family: 'Noto Serif KR',
    source: 'google',
    weights: [400, 700],
    scripts: ['korean'],
  },
  {
    family: 'Nanum Myeongjo',
    source: 'google',
    weights: [400, 700],
    scripts: ['korean'],
  },
  {
    family: 'Black Han Sans',
    source: 'google',
    weights: [400],
    scripts: ['korean'],
  },
];

export const fonts: ThemeFonts = {
  roles: {
    heading: ['Noto Serif KR', 'Nanum Myeongjo', 'serif'],
    body: ['Noto Serif KR', 'Nanum Myeongjo', 'serif'],
    accent: ['Black Han Sans', 'Noto Serif KR', 'sans-serif'],
  },
  recommended: recommendedFonts,
  bundled: [],
};

// === Animations ===
// Animation `name` is auto-namespaced to `korean-traditional-{name}` by the
// theme system. The static keyframes in animations.css use the namespaced form.
export const animations: Partial<Record<ThemeAnimationEvent, AnimationDef>> = {
  'track.change': {
    name: 'brush-stroke',
    enterDuration: 800,
    exitDuration: 400,
  },
  'chat.enter': {
    name: 'scroll-unroll',
    enterDuration: 500,
    stagger: 80,
  },
  'chat.exit': {
    name: 'scroll-roll',
    enterDuration: 300,
  },
  'queue.add': {
    name: 'soft-fade',
    enterDuration: 400,
    stagger: 80,
  },
  'queue.remove': {
    name: 'ink-bleed',
    enterDuration: 300,
  },
  donation: {
    name: 'stamp-press',
    enterDuration: 900,
    iterations: 1,
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
