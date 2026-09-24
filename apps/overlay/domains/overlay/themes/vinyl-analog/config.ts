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
export interface VinylAnalogOptions extends Record<string, unknown> {
  discColor: string;
  labelColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  spinSpeed: number;
  showSpinAnimation: boolean;
}

// === Default option values ===
export const defaultOptions: VinylAnalogOptions = {
  discColor: '#1a1a1a',
  labelColor: '#c0392b',
  accentColor: '#d4a574',
  backgroundColor: '#2c1a10',
  textColor: '#e8d5b7',
  spinSpeed: 4,
  showSpinAnimation: true,
};

// === Option schema (UI form) ===
export const optionSchema: OptionField[] = [
  {
    key: 'discColor',
    type: 'color',
    default: defaultOptions.discColor,
    label: 'Disc color',
    group: 'colors',
  },
  {
    key: 'labelColor',
    type: 'color',
    default: defaultOptions.labelColor,
    label: 'Label color',
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
    key: 'spinSpeed',
    type: 'range',
    default: defaultOptions.spinSpeed,
    min: 1,
    max: 10,
    label: 'Spin speed (sec/rev)',
    group: 'effects',
  },
  {
    key: 'showSpinAnimation',
    type: 'toggle',
    default: defaultOptions.showSpinAnimation,
    label: 'Show spin animation',
    group: 'effects',
  },
];

// === Presets ===
export const presets: ThemePreset<VinylAnalogOptions>[] = [
  {
    id: 'vinyl-analog:classic-vinyl',
    name: 'Classic Vinyl',
    description: '딥 블랙 LP와 따뜻한 우드 브라운 배경. 클래식한 턴테이블 감성.',
    options: {
      discColor: '#1a1a1a',
      labelColor: '#c0392b',
      accentColor: '#d4a574',
      backgroundColor: '#2c1a10',
      textColor: '#e8d5b7',
      spinSpeed: 4,
      showSpinAnimation: true,
    },
    isDefault: true,
  },
  {
    id: 'vinyl-analog:jazz-club',
    name: 'Jazz Club',
    description: '어두운 재즈 클럽의 무드. 골드 악센트와 크림 컬러.',
    options: {
      discColor: '#0a0a0a',
      labelColor: '#c0392b',
      accentColor: '#d4af37',
      backgroundColor: '#1a0f0a',
      textColor: '#f0e6c8',
      spinSpeed: 4,
      showSpinAnimation: true,
    },
  },
  {
    id: 'vinyl-analog:70s-rock',
    name: '70s Rock',
    description: '70년대 록 LP 감성. 따뜻한 오렌지 톤과 레드 라벨.',
    options: {
      discColor: '#1a0a0a',
      labelColor: '#c0392b',
      accentColor: '#ff8c42',
      backgroundColor: '#3a1a08',
      textColor: '#ffe8d6',
      spinSpeed: 4,
      showSpinAnimation: true,
    },
  },
  {
    id: 'vinyl-analog:lofi-chill',
    name: 'Lofi Chill',
    description: '차분한 로파이 무드. 노르딕 블루 그레이와 아이스 악센트.',
    options: {
      discColor: '#2a2a2a',
      labelColor: '#c0392b',
      accentColor: '#88c0d0',
      backgroundColor: '#2e3440',
      textColor: '#d8dee9',
      spinSpeed: 4,
      showSpinAnimation: true,
    },
  },
];

// === Fonts ===
const recommendedFonts: FontEntry[] = [
  {
    family: 'Playfair Display',
    source: 'google',
    weights: [400, 700, 900],
    scripts: ['latin'],
  },
  {
    family: 'Lora',
    source: 'google',
    weights: [400, 700],
    scripts: ['latin'],
  },
];

export const fonts: ThemeFonts = {
  roles: {
    heading: ['Playfair Display', 'Nanum Myeongjo', 'serif'],
    body: ['Lora', 'Nanum Myeongjo', 'serif'],
    accent: ['Lora', 'serif'],
  },
  recommended: recommendedFonts,
  bundled: [],
};

// === Animations ===
// Animation `name` is auto-namespaced to `vinyl-analog-{name}` by the theme
// system. The static keyframes in animations.css use the namespaced form.
export const animations: Partial<Record<ThemeAnimationEvent, AnimationDef>> = {
  'track.change': {
    name: 'lp-swap',
    enterDuration: 700,
    exitDuration: 400,
  },
  'chat.enter': {
    name: 'vintage-slide',
    enterDuration: 400,
    stagger: 60,
  },
  'chat.exit': {
    name: 'paper-fade',
    enterDuration: 200,
  },
  'queue.add': {
    name: 'record-slide',
    enterDuration: 500,
    stagger: 80,
  },
  'queue.remove': {
    name: 'record-slide-out',
    enterDuration: 300,
  },
  donation: {
    name: 'gold-glow',
    enterDuration: 900,
    iterations: 1,
  },
};

// === Performance hints ===
export const performance: ThemePerformanceHints = {
  maxFontFamilies: 2,
};

// === CSS variables (consumed by widget components) ===
export const cssVariables: Record<string, string> = {
  '--vinyl-analog-disc': defaultOptions.discColor,
  '--vinyl-analog-label': defaultOptions.labelColor,
  '--vinyl-analog-accent': defaultOptions.accentColor,
  '--vinyl-analog-bg': defaultOptions.backgroundColor,
  '--vinyl-analog-text': defaultOptions.textColor,
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
