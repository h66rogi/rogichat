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
export interface NeonCyberpunkOptions extends Record<string, unknown> {
  primaryNeon: string;
  secondaryNeon: string;
  accentNeon: string;
  backgroundColor: string;
  glowIntensity: number;
  showScanlines: boolean;
  glitchOnTransition: boolean;
}

// === Default option values ===
// Matches the "magenta-city" preset — Cyberpunk 2077 magenta + cyan + purple
// on deep black. These values are duplicated into the default preset below
// so both stay in sync when edited.
export const defaultOptions: NeonCyberpunkOptions = {
  primaryNeon: '#ff00ff',
  secondaryNeon: '#00fff7',
  accentNeon: '#7b2ff7',
  backgroundColor: '#05000a',
  glowIntensity: 75,
  showScanlines: true,
  glitchOnTransition: true,
};

// === Option schema (UI form) ===
export const optionSchema: OptionField[] = [
  {
    key: 'primaryNeon',
    type: 'color',
    default: defaultOptions.primaryNeon,
    label: 'Primary neon',
    group: 'colors',
  },
  {
    key: 'secondaryNeon',
    type: 'color',
    default: defaultOptions.secondaryNeon,
    label: 'Secondary neon',
    group: 'colors',
  },
  {
    key: 'accentNeon',
    type: 'color',
    default: defaultOptions.accentNeon,
    label: 'Accent neon',
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
    key: 'glowIntensity',
    type: 'range',
    default: defaultOptions.glowIntensity,
    min: 0,
    max: 100,
    label: 'Glow intensity',
    group: 'effects',
  },
  {
    key: 'showScanlines',
    type: 'toggle',
    default: defaultOptions.showScanlines,
    label: 'Show scanlines',
    group: 'effects',
  },
  {
    key: 'glitchOnTransition',
    type: 'toggle',
    default: defaultOptions.glitchOnTransition,
    label: 'Glitch on transition',
    group: 'effects',
  },
];

// === Presets ===
export const presets: ThemePreset<NeonCyberpunkOptions>[] = [
  {
    id: 'neon-cyberpunk:magenta-city',
    name: 'Magenta City',
    description: '한밤의 네온사인. 마젠타 + 시안 + 퍼플의 클래식 사이버펑크.',
    options: {
      primaryNeon: '#ff00ff',
      secondaryNeon: '#00fff7',
      accentNeon: '#7b2ff7',
      backgroundColor: '#05000a',
      glowIntensity: 75,
      showScanlines: true,
      glitchOnTransition: true,
    },
    isDefault: true,
  },
  {
    id: 'neon-cyberpunk:cyan-matrix',
    name: 'Cyan Matrix',
    description: '시안 그린의 서버룸 무드. 매트릭스 터미널 감성.',
    options: {
      primaryNeon: '#00fff7',
      secondaryNeon: '#00ff80',
      accentNeon: '#0080ff',
      backgroundColor: '#05000a',
      glowIntensity: 75,
      showScanlines: true,
      glitchOnTransition: true,
    },
  },
  {
    id: 'neon-cyberpunk:purple-rain',
    name: 'Purple Rain',
    description: '보라 + 마젠타의 비 내리는 메가시티.',
    options: {
      primaryNeon: '#a020f0',
      secondaryNeon: '#ff00cc',
      accentNeon: '#5500aa',
      backgroundColor: '#05000a',
      glowIntensity: 75,
      showScanlines: true,
      glitchOnTransition: true,
    },
  },
  {
    id: 'neon-cyberpunk:amber-warning',
    name: 'Amber Warning',
    description: '경고등 앰버-레드. 디스토피아 빌딩 루프탑 감성.',
    options: {
      primaryNeon: '#ffaa00',
      secondaryNeon: '#ff5500',
      accentNeon: '#ff0000',
      backgroundColor: '#0a0500',
      glowIntensity: 75,
      showScanlines: true,
      glitchOnTransition: true,
    },
  },
];

// === Fonts ===
const recommendedFonts: FontEntry[] = [
  {
    family: 'Orbitron',
    source: 'google',
    weights: [400, 700],
    scripts: ['latin'],
  },
  {
    family: 'Rajdhani',
    source: 'google',
    weights: [400, 500, 700],
    scripts: ['latin'],
  },
  {
    family: 'DM Sans',
    source: 'google',
    weights: [400, 500, 700],
    scripts: ['latin'],
  },
];

export const fonts: ThemeFonts = {
  roles: {
    heading: ['Orbitron', 'Rajdhani', 'sans-serif'],
    body: ['Rajdhani', 'DM Sans', 'sans-serif'],
    accent: ['Orbitron', 'monospace'],
  },
  recommended: recommendedFonts,
  bundled: [],
};

// === Animations ===
// Animation `name` is auto-namespaced to `neon-cyberpunk-{name}` by the theme
// system. The static keyframes in animations.css use the namespaced form.
export const animations: Partial<Record<ThemeAnimationEvent, AnimationDef>> = {
  'track.change': {
    name: 'glitch-transition',
    enterDuration: 500,
    exitDuration: 300,
  },
  'chat.enter': {
    name: 'neon-fadein',
    enterDuration: 400,
    stagger: 50,
  },
  'chat.exit': {
    name: 'glitch-out',
    enterDuration: 200,
  },
  'queue.add': {
    name: 'scan-sweep',
    enterDuration: 450,
    stagger: 80,
  },
  'queue.remove': {
    name: 'neon-dim',
    enterDuration: 300,
  },
  donation: {
    name: 'glow-explosion',
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
  '--neon-cyberpunk-primary': defaultOptions.primaryNeon,
  '--neon-cyberpunk-secondary': defaultOptions.secondaryNeon,
  '--neon-cyberpunk-accent': defaultOptions.accentNeon,
  '--neon-cyberpunk-bg': defaultOptions.backgroundColor,
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
