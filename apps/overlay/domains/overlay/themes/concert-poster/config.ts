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
export interface ConcertPosterOptions extends Record<string, unknown> {
  accentColor: string;
  titleColor: string;
  textColor: string;
  shadowOffset: number;
  shadowColor: string;
  mutedColor: string;
}

// === Default option values ===
export const defaultOptions: ConcertPosterOptions = {
  accentColor: '#7B5BFF',
  titleColor: '#FAF8FF',
  textColor: '#D9D2FF',
  shadowOffset: 2,
  shadowColor: '#160B33',
  mutedColor: '#7C7791',
};

// === Option schema (UI form) ===
export const optionSchema: OptionField[] = [
  {
    key: 'accentColor',
    type: 'color',
    default: defaultOptions.accentColor,
    label: '액센트 (보라)',
    group: 'colors',
  },
  {
    key: 'titleColor',
    type: 'color',
    default: defaultOptions.titleColor,
    label: '곡명 컬러',
    group: 'colors',
  },
  {
    key: 'textColor',
    type: 'color',
    default: defaultOptions.textColor,
    label: '아티스트 / 본문 컬러',
    group: 'colors',
  },
  {
    key: 'mutedColor',
    type: 'color',
    default: defaultOptions.mutedColor,
    label: '보조 텍스트 컬러',
    group: 'colors',
  },
  {
    key: 'shadowOffset',
    type: 'range',
    default: defaultOptions.shadowOffset,
    min: 1,
    max: 6,
    label: '드롭 섀도우 두께 (px)',
    group: 'effects',
  },
  {
    key: 'shadowColor',
    type: 'color',
    default: defaultOptions.shadowColor,
    label: '드롭 섀도우 컬러',
    group: 'effects',
  },
];

// === Presets ===
export const presets: ThemePreset<ConcertPosterOptions>[] = [
  {
    id: 'concert-poster:meloming',
    name: '멜로밍 보라',
    description: '브랜드 보라 + 부드러운 글로우. 기본값.',
    options: defaultOptions,
    isDefault: true,
  },
  {
    id: 'concert-poster:midnight',
    name: '미드나잇 블루',
    description: '심야 라이브 톤. 차분한 인디고 액센트.',
    options: {
      accentColor: '#5B6CFF',
      titleColor: '#F2F4FF',
      textColor: '#C5CCFF',
      shadowOffset: 2,
      shadowColor: '#0A0E2A',
      mutedColor: '#7C7791',
    },
  },
  {
    id: 'concert-poster:peach',
    name: '피치 글로우',
    description: '따뜻한 살구 + 코랄 톤. 데이타임 라이브용.',
    options: {
      accentColor: '#FF8FA3',
      titleColor: '#FFF6F1',
      textColor: '#FFD6CD',
      shadowOffset: 2,
      shadowColor: '#3D1320',
      mutedColor: '#7C7791',
    },
  },
  {
    id: 'concert-poster:mint',
    name: '민트 라임',
    description: '청량한 민트 톤. 가벼운 분위기 매칭.',
    options: {
      accentColor: '#4DD4B5',
      titleColor: '#F1FFFB',
      textColor: '#B5F1E2',
      shadowOffset: 2,
      shadowColor: '#0E2A24',
      mutedColor: '#7C7791',
    },
  },
];

// === Fonts ===
const recommendedFonts: FontEntry[] = [
  {
    family: 'IBM Plex Sans',
    source: 'google',
    weights: [400, 500, 600, 700],
    scripts: ['latin'],
  },
  {
    family: 'IBM Plex Sans KR',
    source: 'google',
    weights: [400, 500, 600, 700],
    scripts: ['korean'],
  },
  {
    family: 'IBM Plex Sans JP',
    source: 'google',
    weights: [400, 500, 600, 700],
    scripts: ['japanese'],
  },
];

export const fonts: ThemeFonts = {
  // Order matters: the browser picks the first font in the chain that has a
  // glyph for the codepoint. Latin → KR → JP gives us a tri-script song
  // title pipeline (e.g. `Lemon`, `봄날`, `夜に駆ける`) all in the same
  // visual system. NanumSquare Neo + Pretendard live at the tail as
  // safety-net fallbacks while Plex is still downloading.
  roles: {
    heading: [
      'IBM Plex Sans',
      'IBM Plex Sans KR',
      'IBM Plex Sans JP',
      'NanumSquare Neo',
      'Pretendard',
      'sans-serif',
    ],
    body: [
      'IBM Plex Sans',
      'IBM Plex Sans KR',
      'IBM Plex Sans JP',
      'NanumSquare Neo',
      'Pretendard',
      'sans-serif',
    ],
  },
  recommended: recommendedFonts,
  bundled: [],
};

// === Animations ===
// Animation `name` is auto-namespaced to `concert-poster-{name}` by the
// theme system. Static keyframes in animations.css use the namespaced form.
export const animations: Partial<Record<ThemeAnimationEvent, AnimationDef>> = {
  'track.change': {
    name: 'poster-slide',
    enterDuration: 320,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  },
  'chat.enter': {
    name: 'poster-stamp',
    enterDuration: 220,
    stagger: 35,
  },
  'chat.exit': {
    name: 'poster-fade-out',
    enterDuration: 140,
  },
  'queue.add': {
    name: 'poster-slide-in',
    enterDuration: 260,
    stagger: 50,
  },
  'queue.remove': {
    name: 'poster-fade-out',
    enterDuration: 160,
  },
  donation: {
    name: 'poster-spotlight',
    enterDuration: 600,
    iterations: 1,
  },
};

// === Performance hints ===
export const performance: ThemePerformanceHints = {
  maxFontFamilies: 3,
};

// === CSS variables (consumed by widget components) ===
export const cssVariables: Record<string, string> = {
  '--concert-poster-accent': defaultOptions.accentColor,
  '--concert-poster-title': defaultOptions.titleColor,
  '--concert-poster-text': defaultOptions.textColor,
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
