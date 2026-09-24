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
// NOTE: Interface uses `ThreeDDepth` prefix because TypeScript identifiers
// cannot start with a digit. The theme directory / id remain `3d-depth`.
export interface ThreeDDepthOptions extends Record<string, unknown> {
  baseColor: string;
  accentColor: string;
  highlightColor: string;
  textColor: string;
  perspective: number;
  rotateY: number;
  rotateX: number;
  shadowDepth: number;
}

// === Default option values ===
// Matches the `3d-depth:midnight-slate` preset below.
export const defaultOptions: ThreeDDepthOptions = {
  baseColor: '#1e293b',
  accentColor: '#6366f1',
  highlightColor: '#a78bfa',
  textColor: '#ffffff',
  perspective: 800,
  rotateY: -10,
  rotateX: 5,
  shadowDepth: 20,
};

// === Option schema (UI form) ===
export const optionSchema: OptionField[] = [
  {
    key: 'baseColor',
    type: 'color',
    default: defaultOptions.baseColor,
    label: 'Base color',
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
    label: 'Highlight color',
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
    key: 'perspective',
    type: 'range',
    default: defaultOptions.perspective,
    min: 400,
    max: 1200,
    step: 10,
    label: 'Perspective (px)',
    group: 'effects',
  },
  {
    key: 'rotateY',
    type: 'range',
    default: defaultOptions.rotateY,
    min: -20,
    max: 20,
    step: 1,
    label: 'Rotate Y (deg)',
    group: 'effects',
  },
  {
    key: 'rotateX',
    type: 'range',
    default: defaultOptions.rotateX,
    min: -20,
    max: 20,
    step: 1,
    label: 'Rotate X (deg)',
    group: 'effects',
  },
  {
    key: 'shadowDepth',
    type: 'range',
    default: defaultOptions.shadowDepth,
    min: 8,
    max: 40,
    step: 1,
    label: 'Shadow depth',
    group: 'effects',
  },
];

// === Presets ===
export const presets: ThemePreset<ThreeDDepthOptions>[] = [
  {
    id: '3d-depth:midnight-slate',
    name: 'Midnight Slate',
    description:
      '슬레이트 베이스 위에 인디고/바이올렛 하이라이트. 3D 카드의 기본 프리셋.',
    options: {
      baseColor: '#1e293b',
      accentColor: '#6366f1',
      highlightColor: '#a78bfa',
      textColor: '#ffffff',
      perspective: 800,
      rotateY: -10,
      rotateX: 5,
      shadowDepth: 20,
    },
    isDefault: true,
  },
  {
    id: '3d-depth:indigo-float',
    name: 'Indigo Float',
    description: '깊은 밤하늘 톤 위에 떠 있는 듯한 인디고 카드.',
    options: {
      baseColor: '#0c1024',
      accentColor: '#818cf8',
      highlightColor: '#c4b5fd',
      textColor: '#ffffff',
      perspective: 800,
      rotateY: -10,
      rotateX: 5,
      shadowDepth: 20,
    },
  },
  {
    id: '3d-depth:deep-purple',
    name: 'Deep Purple',
    description: '짙은 보라 베이스에 바이올렛/라벤더 하이라이트.',
    options: {
      baseColor: '#1a0a2e',
      accentColor: '#9333ea',
      highlightColor: '#d8b4fe',
      textColor: '#ffffff',
      perspective: 800,
      rotateY: -10,
      rotateX: 5,
      shadowDepth: 20,
    },
  },
  {
    id: '3d-depth:steel-gray',
    name: 'Steel Gray',
    description: '차가운 철제 느낌의 스틸 그레이 + 라이트 하이라이트.',
    options: {
      baseColor: '#27272a',
      accentColor: '#94a3b8',
      highlightColor: '#e2e8f0',
      textColor: '#ffffff',
      perspective: 800,
      rotateY: -10,
      rotateX: 5,
      shadowDepth: 20,
    },
  },
];

// === Fonts ===
const recommendedFonts: FontEntry[] = [
  {
    family: 'Inter',
    source: 'google',
    weights: [400, 700],
    scripts: ['latin'],
  },
  {
    family: 'Poppins',
    source: 'google',
    weights: [400, 500, 700],
    scripts: ['latin'],
  },
  {
    family: 'Outfit',
    source: 'google',
    weights: [400, 700],
    scripts: ['latin'],
  },
];

export const fonts: ThemeFonts = {
  roles: {
    heading: ['Inter', 'Poppins', 'sans-serif'],
    body: ['Poppins', 'Inter', 'sans-serif'],
    accent: ['Outfit', 'Inter', 'sans-serif'],
  },
  recommended: recommendedFonts,
  bundled: [],
};

// === Animations ===
// Animation `name` is auto-namespaced to `3d-depth-{name}` by the theme
// system. The static keyframes in animations.css use the namespaced form.
export const animations: Partial<Record<ThemeAnimationEvent, AnimationDef>> = {
  'track.change': {
    name: 'card-flip',
    enterDuration: 700,
    exitDuration: 400,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  },
  'chat.enter': {
    name: 'depth-slide',
    enterDuration: 450,
    stagger: 60,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  },
  'chat.exit': {
    name: 'recede',
    enterDuration: 300,
    easing: 'ease-in',
  },
  'queue.add': {
    name: 'depth-pop',
    enterDuration: 500,
    stagger: 80,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  },
  'queue.remove': {
    name: 'recede-out',
    enterDuration: 300,
    easing: 'ease-in',
  },
  donation: {
    name: 'card-jump',
    enterDuration: 1000,
    iterations: 1,
    easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
};

// === Performance hints ===
export const performance: ThemePerformanceHints = {
  uses3DTransform: true,
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
