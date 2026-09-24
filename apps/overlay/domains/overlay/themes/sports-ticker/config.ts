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
export interface SportsTickerOptions extends Record<string, unknown> {
  brandColor: string;
  accentColor: string;
  textColor: string;
  tickerSpeed: number;
  liveBlinkSpeed: number;
  showLiveIndicator: boolean;
  backgroundColor: string;
}

// === Default option values ===
export const defaultOptions: SportsTickerOptions = {
  brandColor: '#c0392b',
  accentColor: '#1a1a2e',
  textColor: '#ffffff',
  tickerSpeed: 14,
  liveBlinkSpeed: 1.5,
  showLiveIndicator: true,
  backgroundColor: '#0a0a1a',
};

// === Option schema (UI form) ===
export const optionSchema: OptionField[] = [
  {
    key: 'brandColor',
    type: 'color',
    default: defaultOptions.brandColor,
    label: '시그니처 컬러',
    helpText:
      'LIVE 뱃지, 좌측 ON AIR strip, 도네/포인트 보더 등 시각 강조에 쓰이는 메인 색.',
    group: 'colors',
  },
  {
    key: 'accentColor',
    type: 'color',
    default: defaultOptions.accentColor,
    label: '티커 바 배경',
    helpText:
      '하단에 흐르는 마퀴(ticker) 바 배경색. 그 위에 곡명/메시지 텍스트가 지나갑니다.',
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
    key: 'backgroundColor',
    type: 'color',
    default: defaultOptions.backgroundColor,
    label: 'Background',
    group: 'colors',
  },
  {
    key: 'tickerSpeed',
    type: 'range',
    default: defaultOptions.tickerSpeed,
    min: 6,
    max: 30,
    label: 'Ticker scroll speed (sec)',
    group: 'effects',
  },
  {
    key: 'liveBlinkSpeed',
    type: 'range',
    default: defaultOptions.liveBlinkSpeed,
    min: 0.5,
    max: 3,
    step: 0.5,
    label: 'LIVE indicator blink speed (sec)',
    group: 'effects',
  },
  {
    key: 'showLiveIndicator',
    type: 'toggle',
    default: defaultOptions.showLiveIndicator,
    label: 'Show LIVE indicator',
    group: 'effects',
  },
];

// === Presets ===
export const presets: ThemePreset<SportsTickerOptions>[] = [
  {
    id: 'sports-ticker:news-desk',
    name: 'News Desk',
    description: '클래식 뉴스 데스크. 브로드캐스트 레드 + 네이비.',
    isDefault: true,
    options: {
      brandColor: '#c0392b',
      accentColor: '#1a1a2e',
      textColor: '#ffffff',
      tickerSpeed: 14,
      liveBlinkSpeed: 1.5,
      showLiveIndicator: true,
      backgroundColor: '#0a0a1a',
    },
  },
  {
    id: 'sports-ticker:sports-bar',
    name: 'Sports Bar',
    description: '스포츠 중계 느낌. 짙은 블루와 옐로우 포인트.',
    options: {
      brandColor: '#1e3a8a',
      accentColor: '#fbbf24',
      textColor: '#ffffff',
      tickerSpeed: 14,
      liveBlinkSpeed: 1.5,
      showLiveIndicator: true,
      backgroundColor: '#0a0a1a',
    },
  },
  {
    id: 'sports-ticker:election-night',
    name: 'Election Night',
    description: '선거 개표 방송 스타일. 강렬한 레드/블루 대비.',
    options: {
      brandColor: '#dc2626',
      accentColor: '#1d4ed8',
      textColor: '#ffffff',
      tickerSpeed: 14,
      liveBlinkSpeed: 1.5,
      showLiveIndicator: true,
      backgroundColor: '#0a0a1a',
    },
  },
  {
    id: 'sports-ticker:weather-channel',
    name: 'Weather Channel',
    description: '24시간 기상 채널 톤. 시안 블루 베이스.',
    options: {
      brandColor: '#0ea5e9',
      accentColor: '#0c4a6e',
      textColor: '#ffffff',
      tickerSpeed: 14,
      liveBlinkSpeed: 1.5,
      showLiveIndicator: true,
      backgroundColor: '#0a0a1a',
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
  {
    family: 'Roboto Condensed',
    source: 'google',
    weights: [400, 700],
    scripts: ['latin'],
  },
  {
    family: 'Barlow',
    source: 'google',
    weights: [400, 700, 900],
    scripts: ['latin'],
  },
];

export const fonts: ThemeFonts = {
  roles: {
    heading: ['Inter', 'Roboto Condensed', 'Barlow', 'NanumSquare Neo', 'sans-serif'],
    body: ['Roboto Condensed', 'Inter', 'Barlow', 'NanumSquare Neo', 'sans-serif'],
    accent: ['Barlow', 'Inter', 'sans-serif'],
  },
  recommended: recommendedFonts,
  bundled: [],
};

// === Animations ===
export const animations: Partial<Record<ThemeAnimationEvent, AnimationDef>> = {
  'track.change': {
    name: 'slide-up',
    enterDuration: 500,
    exitDuration: 300,
  },
  'chat.enter': {
    name: 'ticker-scroll-in',
    enterDuration: 400,
    stagger: 60,
  },
  'chat.exit': {
    name: 'scroll-out',
    enterDuration: 300,
  },
  'queue.add': {
    name: 'banner-slide',
    enterDuration: 450,
    stagger: 80,
  },
  'queue.remove': {
    name: 'banner-slide-out',
    enterDuration: 300,
  },
  donation: {
    name: 'breaking-banner',
    enterDuration: 1200,
    iterations: 1,
  },
};

export const performance: ThemePerformanceHints = {
  maxFontFamilies: 2,
};

export const cssVariables: Record<string, string> = {
  '--sports-ticker-brand': defaultOptions.brandColor,
  '--sports-ticker-accent': defaultOptions.accentColor,
  '--sports-ticker-text': defaultOptions.textColor,
  '--sports-ticker-bg': defaultOptions.backgroundColor,
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
