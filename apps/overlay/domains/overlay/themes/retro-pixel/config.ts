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
export interface RetroPixelOptions extends Record<string, unknown> {
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  showScanlines: boolean;
  glowIntensity: number;
  pixelScale: number;
}

// === Default option values ===
export const defaultOptions: RetroPixelOptions = {
  primaryColor: '#ff6ec7',
  accentColor: '#00fff7',
  backgroundColor: '#1a0a2e',
  showScanlines: true,
  glowIntensity: 60,
  pixelScale: 2,
};

// === Option schema (UI form) ===
export const optionSchema: OptionField[] = [
  {
    key: 'primaryColor',
    type: 'color',
    default: defaultOptions.primaryColor,
    label: 'Primary glow color',
    group: 'colors',
  },
  {
    key: 'accentColor',
    type: 'color',
    default: defaultOptions.accentColor,
    label: 'Accent / cyan glow',
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
    key: 'showScanlines',
    type: 'toggle',
    default: defaultOptions.showScanlines,
    label: 'Show CRT scanlines',
    group: 'effects',
  },
  {
    key: 'glowIntensity',
    type: 'range',
    default: defaultOptions.glowIntensity,
    min: 0,
    max: 100,
    label: 'Neon glow intensity',
    group: 'effects',
  },
  {
    key: 'pixelScale',
    type: 'range',
    default: defaultOptions.pixelScale,
    min: 1,
    max: 4,
    label: 'Pixel scale factor',
    group: 'layout',
  },
];

// === Presets ===
export const presets: ThemePreset<RetroPixelOptions>[] = [
  {
    id: 'retro-pixel:neon-pink-classic',
    name: 'Neon Pink Classic',
    description: '핑크 + 시안의 클래식한 80년대 아케이드 감성',
    options: {
      primaryColor: '#ff6ec7',
      accentColor: '#00fff7',
      backgroundColor: '#1a0a2e',
      showScanlines: true,
      glowIntensity: 60,
      pixelScale: 2,
    },
    isDefault: true,
  },
  {
    id: 'retro-pixel:matrix-green',
    name: 'Matrix Green',
    description: '터미널 매트릭스에서 튀어나온 듯한 녹색 픽셀',
    options: {
      primaryColor: '#00ff41',
      accentColor: '#00ff80',
      backgroundColor: '#000000',
      showScanlines: true,
      glowIntensity: 70,
      pixelScale: 2,
    },
  },
  {
    id: 'retro-pixel:arcade-gold',
    name: 'Arcade Gold',
    description: '8-bit 황금 아케이드 머신 감성',
    options: {
      primaryColor: '#ffd700',
      accentColor: '#ff8c00',
      backgroundColor: '#1a1000',
      showScanlines: true,
      glowIntensity: 55,
      pixelScale: 2,
    },
  },
];

// === Fonts ===
const recommendedFonts: FontEntry[] = [
  {
    family: 'Press Start 2P',
    source: 'google',
    weights: [400],
    scripts: ['latin'],
  },
  {
    family: 'Silkscreen',
    source: 'google',
    weights: [400, 700],
    scripts: ['latin'],
  },
  {
    family: 'VT323',
    source: 'google',
    weights: [400],
    scripts: ['latin'],
  },
];

export const fonts: ThemeFonts = {
  roles: {
    heading: ['Press Start 2P', 'Silkscreen', 'DungGeunMo', 'monospace'],
    body: ['Silkscreen', 'Press Start 2P', 'DungGeunMo', 'monospace'],
  },
  recommended: recommendedFonts,
  bundled: [],
};

// === Animations ===
// Animation `name` is auto-namespaced to `retro-pixel-{name}` by the theme
// system. The static keyframes in animations.css use the namespaced form.
export const animations: Partial<Record<ThemeAnimationEvent, AnimationDef>> = {
  'track.change': {
    name: 'dissolve',
    enterDuration: 400,
    exitDuration: 200,
    easing: 'steps(8, end)',
  },
  'chat.enter': {
    name: 'typewriter',
    enterDuration: 200,
    stagger: 30,
    easing: 'steps(20, end)',
  },
  'chat.exit': {
    name: 'fade-out',
    enterDuration: 150,
    easing: 'ease-out',
  },
  'queue.add': {
    name: 'drop-in',
    enterDuration: 300,
    stagger: 60,
    easing: 'steps(6, end)',
  },
  'queue.remove': {
    name: 'fade-out',
    enterDuration: 200,
    easing: 'ease-in',
  },
  donation: {
    name: 'coin-insert',
    enterDuration: 600,
    iterations: 1,
    easing: 'steps(10, end)',
  },
};

// === Performance hints ===
export const performance: ThemePerformanceHints = {
  usesHeavyAnimation: true,
  maxFontFamilies: 3,
};

// === CSS variables (consumed by widget components) ===
export const cssVariables: Record<string, string> = {
  '--retro-pixel-primary': defaultOptions.primaryColor,
  '--retro-pixel-accent': defaultOptions.accentColor,
  '--retro-pixel-bg': defaultOptions.backgroundColor,
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
