/**
 * Theme catalog — single source of truth for the 13 overlay themes.
 *
 * The catalog is consumed by:
 *  - meloming-back: validates `themeId` / option keys for the overlay-theme API
 *    and serves the catalog via `GET /overlay-themes`.
 *  - meloming-front: renders the Settings UI (theme grid, preset list,
 *    auto-generated option forms).
 *  - meloming-overlay: mirrors the metadata for theme component implementations.
 *
 * IMPORTANT: every entry MUST define all six animation events
 * (track.change, chat.enter, chat.exit, queue.add, queue.remove, donation).
 * Preset IDs MUST follow the `{themeId}:{slug}` format.
 *
 * Source spec: docs/superpowers/specs/2026-04-07-overlay-theme-diversification-design.md
 */

import type { ThemeId } from './theme-ids.js';
import { THEME_IDS } from './theme-ids.js';
import type {
  FontEntry,
  OptionField,
  ThemeCatalogEntry,
  ThemePreset,
  ThemeSubtheme,
} from './types.js';

// === Common option & font definitions ===
//
// Every theme exposes a shared set of typography/color controls at the top of
// its `optionSchema`, keyed under the `common` group, so the auto-generated
// Settings form renders a consistent block before theme-specific controls.
// Per-theme defaults (textColor / accentColor / textWeight / fontFamily) are
// applied via `buildCommonOptions(...)`.

const TEXT_WEIGHT_CHOICES: {
  value: string;
  label: string;
}[] = [
  { value: 'light', label: 'Light' },
  { value: 'normal', label: 'Normal' },
  { value: 'medium', label: 'Medium' },
  { value: 'semibold', label: 'Semibold' },
  { value: 'bold', label: 'Bold' },
  { value: 'black', label: 'Black' },
];

interface CommonOptionDefaults {
  fontFamily: string;
  textWeight: string;
  textColor: string;
  accentColor: string;
  textSize?: number;
  backgroundOpacity?: number;
  borderOpacity?: number;
  blurIntensity?: number;
}

/**
 * Builds the shared option-schema block (fontFamily / textSize / textWeight /
 * textColor / accentColor) using theme-specific defaults. Each theme prepends
 * the returned array to its own `optionSchema` so the "공통" (common) controls
 * appear first in the Settings UI.
 */
function buildCommonOptions(defaults: CommonOptionDefaults): OptionField[] {
  return [
    {
      key: 'fontFamily',
      type: 'font',
      label: '폰트',
      group: 'common',
      default: defaults.fontFamily,
    },
    {
      key: 'textSize',
      type: 'range',
      label: '텍스트 크기 (배율)',
      group: 'common',
      default: defaults.textSize ?? 1.0,
      min: 0.4,
      max: 2.0,
      step: 0.05,
    },
    {
      key: 'textWeight',
      type: 'select',
      label: '텍스트 굵기',
      group: 'common',
      default: defaults.textWeight,
      choices: TEXT_WEIGHT_CHOICES,
    },
    {
      key: 'textColor',
      type: 'color',
      label: '텍스트 컬러',
      group: 'common',
      default: defaults.textColor,
    },
    {
      key: 'accentColor',
      type: 'color',
      label: '액센트 컬러',
      group: 'common',
      default: defaults.accentColor,
    },
    {
      key: 'backgroundOpacity',
      type: 'range' as const,
      label: '배경 투명도 (%)',
      default: defaults.backgroundOpacity ?? 100,
      min: 0,
      max: 100,
      step: 5,
      group: 'common',
      helpText: '0% = 완전 투명, 100% = 불투명',
    },
    {
      key: 'borderOpacity',
      type: 'range' as const,
      label: '외곽선 투명도 (%)',
      default: defaults.borderOpacity ?? 100,
      min: 0,
      max: 100,
      step: 5,
      group: 'common',
      helpText: '0% = 완전 투명, 100% = 불투명',
    },
    {
      key: 'blurIntensity',
      type: 'range' as const,
      label: '배경 블러 (px)',
      default: defaults.blurIntensity ?? 0,
      min: 0,
      max: 40,
      step: 1,
      group: 'common',
      helpText: '블러가 높을수록 유리 효과. 투명도와 함께 사용 권장',
      unit: 'px',
    },
    {
      key: 'showRequestMethods',
      type: 'toggle' as const,
      label: '셋리스트: 신청방법 안내 표시',
      group: 'general',
      default: true,
      helpText:
        '셋리스트 위젯 상단의 "신청방법" 안내(채팅/후원/멜로밍 사이트 안내) 노출 여부. 끄면 곡 카운터만 표시.',
    },
    {
      key: 'textStrokeEnabled',
      type: 'toggle' as const,
      label: '글자 외곽선',
      group: 'typography',
      default: false,
      helpText:
        '글자 가장자리에 외곽선을 그려 가독성을 높입니다. 빌보드처럼 배경 없이 텍스트만 떠 있는 테마에서 특히 유용합니다.',
    },
    {
      key: 'textStrokeColor',
      type: 'color' as const,
      label: '외곽선 색상',
      group: 'typography',
      default: '#000000',
    },
    {
      key: 'textStrokeWidth',
      type: 'range' as const,
      label: '외곽선 두께 (px)',
      group: 'typography',
      default: 1.5,
      min: 0,
      max: 4,
      step: 0.5,
      unit: 'px',
      helpText: '0 이면 외곽선 없음. 클수록 외곽선이 두꺼워집니다.',
    },
  ];
}

/** Merges common option defaults into a theme's `defaultOptions` record. */
function buildCommonDefaultOptions(
  defaults: CommonOptionDefaults,
): Record<string, unknown> {
  return {
    fontFamily: defaults.fontFamily,
    textSize: defaults.textSize ?? 1.0,
    textWeight: defaults.textWeight,
    textColor: defaults.textColor,
    accentColor: defaults.accentColor,
    backgroundOpacity: defaults.backgroundOpacity ?? 100,
    borderOpacity: defaults.borderOpacity ?? 100,
    blurIntensity: defaults.blurIntensity ?? 0,
    showRequestMethods: true,
    textStrokeEnabled: false,
    textStrokeColor: '#000000',
    textStrokeWidth: 1.5,
  };
}

/**
 * Shared font roster appended to every theme's `fonts.recommended` list.
 * Theme-specific fonts live alongside these entries; duplicates are deduped by
 * `family` via `mergeRecommendedFonts`.
 */
const COMMON_RECOMMENDED_FONTS: FontEntry[] = [
  { family: 'NanumSquare Neo', displayName: '나눔스퀘어 네오', source: 'bundled', weights: [400, 700], scripts: ['korean'] },
  { family: 'Pretendard', displayName: '프리텐다드', source: 'bundled', weights: [400, 500, 600, 700], scripts: ['korean', 'latin'] },
  { family: 'Noto Sans KR', displayName: '본고딕', source: 'google', weights: [400, 500, 700], scripts: ['korean'] },
  { family: 'Gmarket Sans', displayName: 'G마켓 산스', source: 'bundled', weights: [300, 500, 700], scripts: ['korean'] },
  { family: 'Black Han Sans', displayName: '검은고딕', source: 'google', weights: [400], scripts: ['korean'] },
  { family: 'Noto Serif KR', displayName: '본명조', source: 'google', weights: [400, 700, 900], scripts: ['korean'] },
  { family: 'Nanum Myeongjo', displayName: '나눔명조', source: 'google', weights: [400, 700], scripts: ['korean'] },
  { family: 'CookieRun', displayName: '쿠키런', source: 'bundled', weights: [400, 700], scripts: ['korean'] },
  { family: 'Cafe24Surround', displayName: '카페24 써라운드', source: 'bundled', weights: [400], scripts: ['korean'] },
  { family: 'Cafe24Ohsquare', displayName: '카페24 아네모네', source: 'bundled', weights: [400], scripts: ['korean'] },
  { family: 'MapoFlowerIsland', displayName: '마포꽃섬', source: 'bundled', weights: [400], scripts: ['korean'] },
  { family: 'omyu_pretty', displayName: '오뮤 다예쁨체', source: 'bundled', weights: [400], scripts: ['korean'] },
  { family: 'Nanum Pen Script', displayName: '나눔손글씨 펜', source: 'google', weights: [400], scripts: ['korean'] },
];

/**
 * Merges a theme's existing recommended fonts with the shared common roster,
 * preserving the theme-specific entries' order (which in turn preserves their
 * custom weight sets / scripts) and appending any common entries that aren't
 * already present by `family`.
 */
function mergeRecommendedFonts(themeFonts: FontEntry[]): FontEntry[] {
  const seen = new Set(themeFonts.map((entry) => entry.family));
  const merged = [...themeFonts];
  for (const entry of COMMON_RECOMMENDED_FONTS) {
    if (!seen.has(entry.family)) {
      merged.push(entry);
      seen.add(entry.family);
    }
  }
  return merged;
}

// === retro-pixel ===

const retroPixelCommonDefaults: CommonOptionDefaults = {
  fontFamily: 'Press Start 2P',
  textSize: 1.25,
  textWeight: 'normal',
  textColor: '#ff6ec7',
  accentColor: '#00fff7',
};

const retroPixel: ThemeCatalogEntry = {
  id: 'retro-pixel',
  name: '레트로',
  tags: ['retro', 'dark', 'pixel', 'neon', 'gaming'],
  description:
    '8-bit 게임 콘솔 시대의 미감. CRT 모니터 스캔라인과 네온 글로우가 어우러진 픽셀 아트 오버레이.',
  thumbnail: '/themes/retro-pixel/thumbnail.svg',
  fonts: {
    roles: {
      heading: ['Press Start 2P', 'Silkscreen', 'DungGeunMo', 'monospace'],
      body: ['Silkscreen', 'DungGeunMo', 'Pretendard', 'sans-serif'],
      accent: ['Press Start 2P', 'monospace'],
    },
    recommended: mergeRecommendedFonts([
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
      { family: 'VT323', source: 'google', weights: [400], scripts: ['latin'] },
    ]),
    bundled: [
      {
        family: 'DungGeunMo', displayName: '둥근모',
        source: 'bundled',
        weights: [400],
        scripts: ['korean'],
      },
      {
        family: 'Pretendard', displayName: '프리텐다드',
        source: 'bundled',
        weights: [400, 600],
        scripts: ['korean', 'latin'],
      },
    ],
  },
  optionSchema: [
    ...buildCommonOptions(retroPixelCommonDefaults),
    {
      key: 'primaryColor',
      type: 'color',
      label: '메인 컬러',
      group: 'colors',
      default: '#ff6ec7',
    },
    {
      key: 'backgroundColor',
      type: 'color',
      label: '배경 컬러',
      group: 'colors',
      default: '#1a0a2e',
    },
    {
      key: 'showScanlines',
      type: 'toggle',
      label: 'CRT 스캔라인',
      group: 'effects',
      default: true,
    },
    {
      key: 'glowIntensity',
      type: 'range',
      label: '네온 글로우 세기',
      group: 'effects',
      default: 60,
      min: 0,
      max: 100,
      step: 1,
    },
    {
      key: 'pixelScale',
      type: 'range',
      label: '픽셀 스케일',
      group: 'layout',
      default: 2,
      min: 1,
      max: 4,
      step: 1,
    },
  ],
  defaultOptions: {
    showAlbumArt: true,
    ...buildCommonDefaultOptions(retroPixelCommonDefaults),
    primaryColor: '#ff6ec7',
    backgroundColor: '#1a0a2e',
    showScanlines: true,
    glowIntensity: 60,
    pixelScale: 2,
  },
  presets: [
    {
      id: 'retro-pixel:neon-pink-classic',
      name: 'Neon Pink Classic',
      description: '시그니처 네온 핑크/시안 조합.',
      isDefault: true,
      options: {
        primaryColor: '#ff6ec7',
        accentColor: '#00fff7',
        backgroundColor: '#1a0a2e',
        showScanlines: true,
        glowIntensity: 60,
        pixelScale: 2,
      },
    },
    {
      id: 'retro-pixel:matrix-green',
      name: 'Matrix Green',
      description: '단색 그린 터미널 분위기.',
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
      description: '아케이드 게임 캐비닛 골드/레드.',
      options: {
        primaryColor: '#ffd700',
        accentColor: '#ff8c00',
        backgroundColor: '#1a1000',
        showScanlines: true,
        glowIntensity: 55,
        pixelScale: 2,
      },
    },
  ],
  animations: {
    'track.change': {
      name: 'pixel-dissolve',
      enterDuration: 600,
      exitDuration: 400,
      easing: 'steps(8, end)',
    },
    'chat.enter': {
      name: 'typewriter',
      enterDuration: 500,
      easing: 'steps(20, end)',
      stagger: 30,
    },
    'chat.exit': {
      name: 'pixel-fadeout',
      enterDuration: 300,
      easing: 'steps(6, end)',
    },
    'queue.add': {
      name: 'drop-in',
      enterDuration: 350,
      easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    },
    'queue.remove': {
      name: 'pixel-dissolve-out',
      enterDuration: 300,
      easing: 'steps(6, end)',
    },
    donation: {
      name: 'coin-insert',
      enterDuration: 800,
      easing: 'ease-out',
      iterations: 1,
    },
  },
  cssVariables: {
    '--retro-pixel-border': '4px',
    '--retro-pixel-glow-blur': '12px',
  },
  performance: {
    usesHeavyAnimation: true,
    maxFontFamilies: 4,
  },
};

// === glassmorphism ===

const glassmorphismCommonDefaults: CommonOptionDefaults = {
  fontFamily: 'NanumSquare Neo',
  textSize: 1.4,
  textWeight: 'semibold',
  textColor: '#FFFFFF',
  accentColor: '#A78BFA',
  backgroundOpacity: 100,
  borderOpacity: 18,
  blurIntensity: 20,
};

const glassmorphism: ThemeCatalogEntry = {
  id: 'glassmorphism',
  name: '글래스모피즘',
  tags: ['modern', 'glass', 'blur', 'translucent', 'apple'],
  description:
    '반투명 유리 카드. backdrop-filter와 그라데이션 보더로 구성된 현대적 미학.',
  thumbnail: '/themes/glassmorphism/thumbnail.svg',
  fonts: {
    roles: {
      heading: ['Inter', 'SF Pro Display', 'Pretendard', 'sans-serif'],
      body: ['Pretendard', 'Inter', 'Noto Sans KR', 'sans-serif'],
      accent: ['Inter', 'SF Pro Display', 'sans-serif'],
    },
    recommended: mergeRecommendedFonts([]),
    bundled: [
      {
        family: 'Pretendard', displayName: '프리텐다드',
        source: 'bundled',
        weights: [400, 500, 700],
        scripts: ['korean', 'latin'],
      },
      {
        family: 'Noto Sans KR', displayName: '본고딕',
        source: 'bundled',
        weights: [400, 700],
        scripts: ['korean'],
      },
    ],
  },
  optionSchema: [
    ...buildCommonOptions(glassmorphismCommonDefaults),
    {
      key: 'gradientStart',
      type: 'color',
      label: '그라데이션 시작',
      group: 'colors',
      default: '#667eea',
    },
    {
      key: 'gradientEnd',
      type: 'color',
      label: '그라데이션 끝',
      group: 'colors',
      default: '#764ba2',
    },
    {
      key: 'cardOpacity',
      type: 'range',
      label: '카드 투명도 (%)',
      group: 'colors',
      default: 12,
      min: 0,
      max: 100,
      step: 1,
    },
    {
      key: 'glassOpacity',
      type: 'range',
      label: '리퀴드 글래스 투명도',
      group: 'effects',
      default: 0.48,
      min: 0.1,
      max: 0.6,
      step: 0.01,
    },
    {
      key: 'glassBlur',
      type: 'range',
      label: '리퀴드 글래스 블러 (px)',
      group: 'effects',
      default: 32,
      min: 8,
      max: 40,
      step: 1,
    },
  ],
  defaultOptions: {
    showAlbumArt: true,
    ...buildCommonDefaultOptions(glassmorphismCommonDefaults),
    gradientStart: '#667eea',
    gradientEnd: '#764ba2',
    cardOpacity: 12,
    glassOpacity: 0.48,
    glassBlur: 32,
  },
  presets: [
    {
      id: 'glassmorphism:purple-haze',
      name: 'Purple Haze',
      description: '보라 그라데이션 위의 리퀴드 글래스. 기본 프리셋 (강화됨).',
      isDefault: true,
      options: {
        blurIntensity: 20,
        gradientStart: '#667eea',
        gradientEnd: '#764ba2',
        cardOpacity: 12,
        borderOpacity: 18,
        textColor: '#ffffff',
        // Liquid Glass 강화값(defaultOptions와 동기화) — 기본 프리셋 적용 시
        // Apple iOS 26 스타일 굴절/스페큘러가 유지되도록 old 0.28/20에서 bump.
        glassOpacity: 0.48,
        glassBlur: 32,
      },
    },
    {
      id: 'glassmorphism:ocean-breeze',
      name: 'Ocean Breeze',
      description: '시원한 바다 그라데이션 위의 가벼운 리퀴드 글래스.',
      options: {
        blurIntensity: 22,
        gradientStart: '#4facfe',
        gradientEnd: '#00f2fe',
        cardOpacity: 14,
        borderOpacity: 22,
        textColor: '#ffffff',
        glassOpacity: 0.42,
        glassBlur: 30,
      },
    },
    {
      id: 'glassmorphism:midnight-blue',
      name: 'Midnight Blue',
      description: '깊은 밤하늘 톤의 다크 리퀴드 글래스.',
      options: {
        blurIntensity: 24,
        gradientStart: '#1e3a8a',
        gradientEnd: '#0c1a40',
        cardOpacity: 16,
        borderOpacity: 24,
        textColor: '#e6efff',
        glassOpacity: 0.52,
        glassBlur: 34,
      },
    },
    {
      id: 'glassmorphism:rose-gold',
      name: 'Rose Gold',
      description: '핑크-골드 선셋 리퀴드 글래스.',
      options: {
        blurIntensity: 20,
        gradientStart: '#fa709a',
        gradientEnd: '#fee140',
        cardOpacity: 14,
        borderOpacity: 22,
        textColor: '#ffffff',
        glassOpacity: 0.44,
        glassBlur: 30,
      },
    },
  ],
  animations: {
    'track.change': {
      name: 'blur-fade',
      enterDuration: 500,
      exitDuration: 350,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
    },
    'chat.enter': {
      name: 'slide-fade-in',
      enterDuration: 320,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
      stagger: 60,
    },
    'chat.exit': {
      name: 'fade-out',
      enterDuration: 220,
      easing: 'ease-out',
    },
    'queue.add': {
      name: 'soft-slide-down',
      enterDuration: 400,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    },
    'queue.remove': {
      name: 'soft-slide-out',
      enterDuration: 280,
      easing: 'ease-out',
    },
    donation: {
      name: 'glow-pulse',
      enterDuration: 900,
      easing: 'ease-in-out',
      iterations: 2,
    },
  },
  cssVariables: {
    '--glass-card-bg': 'rgba(255, 255, 255, 0.18)',
    '--glass-blur': '20px',
  },
  performance: {
    usesBackdropFilter: true,
    maxFontFamilies: 3,
  },
};

// === brutalist ===

const brutalistCommonDefaults: CommonOptionDefaults = {
  fontFamily: 'NanumSquare Neo',
  textWeight: 'black',
  textColor: '#000000',
  accentColor: '#ffff00',
};

// brutalist widget (config.ts)는 dangerColor와 tiltAngle 키를 읽는다.
// 이전 catalog은 foregroundColor/tagRotation를 노출해 form 변경이 widget에
// 반영되지 않았음. widget config의 키 이름/범위/기본값으로 정렬한다.

const brutalist: ThemeCatalogEntry = {
  id: 'brutalist',
  name: '브루탈리스트',
  tags: ['brutalist', 'bold', 'raw', 'minimal', 'modern'],
  description:
    '의도적으로 거칠고 투박한 반(反)-미니멀리즘. 두꺼운 보더와 하드 드롭 쉐도우로 강렬한 인상.',
  thumbnail: '/themes/brutalist/thumbnail.svg',
  fonts: {
    roles: {
      heading: ['Inter', 'Arial Black', 'Helvetica Neue', 'sans-serif'],
      body: ['Inter', 'Helvetica', 'Arial', 'sans-serif'],
      accent: ['Inter', 'Arial Black', 'sans-serif'],
    },
    recommended: mergeRecommendedFonts([]),
    bundled: [
      {
        family: 'Pretendard', displayName: '프리텐다드',
        source: 'bundled',
        weights: [700, 900],
        scripts: ['korean', 'latin'],
      },
      {
        family: 'Black Han Sans', displayName: '검은고딕',
        source: 'bundled',
        weights: [400],
        scripts: ['korean'],
      },
    ],
  },
  optionSchema: [
    ...buildCommonOptions(brutalistCommonDefaults),
    {
      key: 'backgroundColor',
      type: 'color',
      label: '배경 컬러',
      group: 'colors',
      default: '#f5f5dc',
    },
    {
      key: 'dangerColor',
      type: 'color',
      label: 'Danger / LIVE 컬러',
      group: 'colors',
      default: '#ff0000',
    },
    {
      key: 'borderWidth',
      type: 'range',
      label: '보더 두께 (px)',
      group: 'layout',
      default: 5,
      min: 2,
      max: 8,
      step: 1,
    },
    {
      key: 'shadowOffset',
      type: 'range',
      label: '하드 쉐도우 오프셋 (px)',
      group: 'effects',
      default: 10,
      min: 4,
      max: 16,
      step: 1,
    },
    {
      key: 'tiltAngle',
      type: 'range',
      label: '태그 기울기 (도)',
      group: 'layout',
      default: -1,
      min: -5,
      max: 5,
      step: 0.5,
    },
  ],
  defaultOptions: {
    showAlbumArt: true,
    ...buildCommonDefaultOptions(brutalistCommonDefaults),
    backgroundColor: '#f5f5dc',
    dangerColor: '#ff0000',
    borderWidth: 5,
    shadowOffset: 10,
    tiltAngle: -1,
  },
  presets: [
    {
      id: 'brutalist:black-white',
      name: 'Black & White',
      description: '클래식 브루탈리즘. 흑백 + 노란색 포인트.',
      isDefault: true,
      options: {
        accentColor: '#ffff00',
        backgroundColor: '#f5f5dc',
        dangerColor: '#ff0000',
        borderWidth: 5,
        shadowOffset: 10,
        tiltAngle: -1,
      },
    },
    {
      id: 'brutalist:danger-red',
      name: 'Danger Red',
      description: '강렬한 빨강 경고 팔레트. 화이트 배경.',
      options: {
        accentColor: '#ff0000',
        backgroundColor: '#ffffff',
        dangerColor: '#ff0000',
        borderWidth: 5,
        shadowOffset: 10,
        tiltAngle: -1,
      },
    },
    {
      id: 'brutalist:electric-yellow',
      name: 'Electric Yellow',
      description: '형광 노랑 배경 + 블랙 포인트. 최대 대비.',
      options: {
        accentColor: '#000000',
        backgroundColor: '#ffff00',
        dangerColor: '#ff0000',
        borderWidth: 5,
        shadowOffset: 10,
        tiltAngle: -1,
      },
    },
  ],
  animations: {
    'track.change': {
      name: 'hard-cut',
      enterDuration: 0,
      exitDuration: 0,
      easing: 'steps(1, end)',
    },
    'chat.enter': {
      name: 'stamp-in',
      enterDuration: 220,
      easing: 'cubic-bezier(0.5, 1.6, 0.4, 1)',
    },
    'chat.exit': {
      name: 'hard-disappear',
      enterDuration: 0,
      easing: 'steps(1, end)',
    },
    'queue.add': {
      name: 'slap-in',
      enterDuration: 260,
      easing: 'cubic-bezier(0.6, 0, 0.4, 1)',
    },
    'queue.remove': {
      name: 'slap-out',
      enterDuration: 220,
      easing: 'cubic-bezier(0.6, 0, 0.4, 1)',
    },
    donation: {
      name: 'screen-flash-stamp',
      enterDuration: 600,
      easing: 'cubic-bezier(0.5, 1.6, 0.4, 1)',
      iterations: 1,
    },
  },
  cssVariables: {
    '--brutalist-border-width': '5px',
    '--brutalist-shadow-offset': '10px',
  },
};

// === kawaii ===

const kawaiiCommonDefaults: CommonOptionDefaults = {
  fontFamily: 'CookieRun',
  textWeight: 'semibold',
  textColor: '#d63384',
  accentColor: '#b088f9',
};

// kawaii widget은 mainColor/backgroundColor/decorationStyle/borderRadius를 읽는다.
// 이전 catalog은 primaryColor/secondaryColor/showStarDecorations/cardRoundness/
// sparkleIntensity로 다른 이름을 노출하고 있어 form 변경이 widget에 반영 안 됨.
// widget config의 키로 정렬한다.

const kawaii: ThemeCatalogEntry = {
  id: 'kawaii',
  name: '카와이',
  tags: ['kawaii', 'cute', 'pastel', 'anime', 'y2k', 'colorful'],
  description:
    '2000년대 인터넷/애니메이션 미학. 파스텔 컬러와 별/하트 장식으로 화사하고 귀여운 분위기.',
  thumbnail: '/themes/kawaii/thumbnail.svg',
  fonts: {
    roles: {
      heading: ['Fredoka', 'Comfortaa', 'CookieRun', 'sans-serif'],
      body: ['Comfortaa', 'CookieRun', 'Cafe24 Ssurround', 'sans-serif'],
      accent: ['Fredoka', 'CookieRun', 'cursive'],
    },
    recommended: mergeRecommendedFonts([]),
    bundled: [
      {
        family: 'CookieRun', displayName: '쿠키런',
        source: 'bundled',
        weights: [400, 700],
        scripts: ['korean'],
      },
      {
        family: 'Cafe24 Ssurround', displayName: '카페24 써라운드',
        source: 'bundled',
        weights: [400],
        scripts: ['korean'],
      },
    ],
  },
  optionSchema: [
    ...buildCommonOptions(kawaiiCommonDefaults),
    {
      key: 'mainColor',
      type: 'color',
      label: '메인 파스텔',
      group: 'colors',
      default: '#ffb6d9',
    },
    {
      key: 'backgroundColor',
      type: 'color',
      label: '배경 컬러',
      group: 'colors',
      default: '#fff5fa',
    },
    {
      key: 'decorationStyle',
      type: 'select',
      label: '장식 스타일',
      group: 'effects',
      default: 'stars',
      choices: [
        { value: 'stars', label: '별' },
        { value: 'hearts', label: '하트' },
        { value: 'sparkles', label: '스파클' },
      ],
    },
    {
      key: 'borderRadius',
      type: 'range',
      label: '카드 라운드 (px)',
      group: 'layout',
      default: 20,
      min: 8,
      max: 32,
      step: 1,
    },
  ],
  defaultOptions: {
    showAlbumArt: true,
    ...buildCommonDefaultOptions(kawaiiCommonDefaults),
    mainColor: '#ffb6d9',
    backgroundColor: '#fff5fa',
    decorationStyle: 'stars',
    borderRadius: 20,
  },
  presets: [
    {
      id: 'kawaii:cherry-blossom',
      name: 'Cherry Blossom',
      description: '봄날의 벚꽃처럼 부드러운 파스텔 핑크와 라벤더.',
      isDefault: true,
      options: {
        mainColor: '#ffb6d9',
        accentColor: '#b088f9',
        backgroundColor: '#fff5fa',
        textColor: '#d63384',
        decorationStyle: 'stars',
        borderRadius: 20,
      },
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
  ],
  animations: {
    'track.change': {
      name: 'bounce-in',
      enterDuration: 550,
      exitDuration: 320,
      easing: 'cubic-bezier(0.34, 1.8, 0.64, 1)',
    },
    'chat.enter': {
      name: 'pop-bounce',
      enterDuration: 420,
      easing: 'cubic-bezier(0.34, 1.6, 0.64, 1)',
      stagger: 70,
    },
    'chat.exit': {
      name: 'shrink-fade',
      enterDuration: 280,
      easing: 'ease-in',
    },
    'queue.add': {
      name: 'heart-particles-slide',
      enterDuration: 480,
      easing: 'cubic-bezier(0.34, 1.5, 0.64, 1)',
    },
    'queue.remove': {
      name: 'fly-away',
      enterDuration: 360,
      easing: 'cubic-bezier(0.5, 0, 0.75, 0)',
    },
    donation: {
      name: 'star-burst',
      enterDuration: 1100,
      easing: 'ease-out',
      iterations: 1,
    },
  },
  cssVariables: {
    '--kawaii-border-radius': '24px',
  },
  performance: {
    usesHeavyAnimation: true,
    maxFontFamilies: 4,
  },
};

// === vinyl-analog ===

const vinylAnalogCommonDefaults: CommonOptionDefaults = {
  fontFamily: 'Noto Serif KR',
  textWeight: 'normal',
  textColor: '#e8d5b7',
  accentColor: '#d4a574',
};

const vinylAnalog: ThemeCatalogEntry = {
  id: 'vinyl-analog',
  name: '아날로그',
  tags: ['vintage', 'vinyl', 'analog', 'warm', 'serif'],
  description:
    'LP, 턴테이블, 카세트 시대. 회전하는 LP 디스크와 따뜻한 톤으로 음악 자체에 대한 존중을 표현.',
  thumbnail: '/themes/vinyl-analog/thumbnail.svg',
  fonts: {
    roles: {
      heading: ['Playfair Display', 'Nanum Myeongjo', 'Lora', 'serif'],
      body: ['Lora', 'Nanum Myeongjo', 'Noto Serif KR', 'serif'],
      accent: ['Playfair Display', 'serif'],
    },
    recommended: mergeRecommendedFonts([]),
    bundled: [
      {
        family: 'Nanum Myeongjo', displayName: '나눔명조',
        source: 'bundled',
        weights: [400, 700],
        scripts: ['korean'],
      },
      {
        family: 'Noto Serif KR', displayName: '본명조',
        source: 'bundled',
        weights: [400, 700],
        scripts: ['korean'],
      },
    ],
  },
  optionSchema: [
    ...buildCommonOptions(vinylAnalogCommonDefaults),
    {
      key: 'discColor',
      type: 'color',
      label: '디스크 컬러',
      group: 'colors',
      default: '#1a1a1a',
    },
    {
      key: 'labelColor',
      type: 'color',
      label: '라벨 컬러',
      group: 'colors',
      default: '#c0392b',
    },
    {
      key: 'backgroundColor',
      type: 'color',
      label: '배경 컬러',
      group: 'colors',
      default: '#2c1a10',
    },
    {
      key: 'spinSpeed',
      type: 'range',
      label: '회전 속도 (sec/rev)',
      group: 'effects',
      default: 4,
      min: 1,
      max: 10,
      step: 1,
    },
    {
      key: 'showSpinAnimation',
      type: 'toggle',
      label: 'LP 회전 애니메이션',
      group: 'effects',
      default: true,
    },
  ],
  defaultOptions: {
    showAlbumArt: true,
    ...buildCommonDefaultOptions(vinylAnalogCommonDefaults),
    discColor: '#1a1a1a',
    labelColor: '#c0392b',
    backgroundColor: '#2c1a10',
    spinSpeed: 4,
    showSpinAnimation: true,
  },
  presets: [
    {
      id: 'vinyl-analog:classic-vinyl',
      name: 'Classic Vinyl',
      description: '딥 블랙 LP와 따뜻한 우드 브라운 배경. 클래식한 턴테이블 감성.',
      isDefault: true,
      options: {
        discColor: '#1a1a1a',
        labelColor: '#c0392b',
        accentColor: '#d4a574',
        backgroundColor: '#2c1a10',
        textColor: '#e8d5b7',
        spinSpeed: 4,
        showSpinAnimation: true,
      },
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
      name: 'Lo-fi Chill',
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
  ],
  animations: {
    'track.change': {
      name: 'lp-swap',
      enterDuration: 850,
      exitDuration: 600,
      easing: 'cubic-bezier(0.65, 0, 0.35, 1)',
    },
    'chat.enter': {
      name: 'vintage-slide',
      enterDuration: 380,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
      stagger: 80,
    },
    'chat.exit': {
      name: 'soft-fade',
      enterDuration: 280,
      easing: 'ease-out',
    },
    'queue.add': {
      name: 'record-slide-in',
      enterDuration: 460,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    },
    'queue.remove': {
      name: 'record-slide-out',
      enterDuration: 340,
      easing: 'cubic-bezier(0.4, 0, 0.6, 1)',
    },
    donation: {
      name: 'gold-disc-cert',
      enterDuration: 1200,
      easing: 'ease-out',
      iterations: 1,
    },
  },
  cssVariables: {
    '--vinyl-disc-rotation-duration': '1.8s',
  },
};

// === neon-cyberpunk ===

const neonCyberpunkCommonDefaults: CommonOptionDefaults = {
  fontFamily: 'Orbitron',
  textWeight: 'bold',
  textColor: '#00fff7',
  accentColor: '#ff00ff',
};

const neonCyberpunk: ThemeCatalogEntry = {
  id: 'neon-cyberpunk',
  name: '네온',
  tags: ['cyberpunk', 'neon', 'dark', 'futuristic', 'glitch'],
  description:
    '도시 밤거리 네온사인. 다중 레이어 글로우와 글리치 이펙트로 사이버펑크 미학을 구현.',
  thumbnail: '/themes/neon-cyberpunk/thumbnail.svg',
  fonts: {
    roles: {
      heading: ['Orbitron', 'Rajdhani', 'Pretendard', 'sans-serif'],
      body: ['Rajdhani', 'DM Sans', 'Pretendard', 'sans-serif'],
      accent: ['Oxanium', 'Orbitron', 'monospace'],
    },
    recommended: mergeRecommendedFonts([
      {
        family: 'Orbitron',
        source: 'google',
        weights: [400, 700, 900],
        scripts: ['latin'],
      },
      {
        family: 'Rajdhani',
        source: 'google',
        weights: [400, 600, 700],
        scripts: ['latin'],
      },
      {
        family: 'Oxanium',
        source: 'google',
        weights: [400, 700],
        scripts: ['latin'],
      },
    ]),
    bundled: [
      {
        family: 'Pretendard', displayName: '프리텐다드',
        source: 'bundled',
        weights: [500, 700],
        scripts: ['korean', 'latin'],
      },
    ],
  },
  optionSchema: [
    ...buildCommonOptions(neonCyberpunkCommonDefaults),
    {
      key: 'primaryNeon',
      type: 'color',
      label: '프라이머리 네온',
      group: 'colors',
      default: '#ff00ff',
    },
    {
      key: 'secondaryNeon',
      type: 'color',
      label: '세컨더리 네온',
      group: 'colors',
      default: '#00fff7',
    },
    {
      key: 'accentNeon',
      type: 'color',
      label: '액센트 네온',
      group: 'colors',
      default: '#7b2ff7',
    },
    {
      key: 'backgroundColor',
      type: 'color',
      label: '배경 컬러',
      group: 'colors',
      default: '#05000a',
    },
    {
      key: 'glowIntensity',
      type: 'range',
      label: '글로우 세기',
      group: 'effects',
      default: 75,
      min: 0,
      max: 100,
      step: 1,
    },
    {
      key: 'showScanlines',
      type: 'toggle',
      label: '스캔라인',
      group: 'effects',
      default: true,
    },
    {
      key: 'glitchOnTransition',
      type: 'toggle',
      label: '전환 시 글리치',
      group: 'effects',
      default: true,
    },
  ],
  defaultOptions: {
    showAlbumArt: true,
    ...buildCommonDefaultOptions(neonCyberpunkCommonDefaults),
    primaryNeon: '#ff00ff',
    secondaryNeon: '#00fff7',
    accentNeon: '#7b2ff7',
    backgroundColor: '#05000a',
    glowIntensity: 75,
    showScanlines: true,
    glitchOnTransition: true,
  },
  presets: [
    {
      id: 'neon-cyberpunk:magenta-city',
      name: 'Magenta City',
      description: '한밤의 네온사인. 마젠타 + 시안 + 퍼플의 클래식 사이버펑크.',
      isDefault: true,
      options: {
        primaryNeon: '#ff00ff',
        secondaryNeon: '#00fff7',
        accentNeon: '#7b2ff7',
        backgroundColor: '#05000a',
        glowIntensity: 75,
        showScanlines: true,
        glitchOnTransition: true,
      },
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
  ],
  animations: {
    'track.change': {
      name: 'glitch-transition',
      enterDuration: 700,
      exitDuration: 500,
      easing: 'steps(8, end)',
    },
    'chat.enter': {
      name: 'neon-fade-in',
      enterDuration: 400,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
      stagger: 60,
    },
    'chat.exit': {
      name: 'glitch-out',
      enterDuration: 280,
      easing: 'steps(6, end)',
    },
    'queue.add': {
      name: 'scanline-sweep',
      enterDuration: 460,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    },
    'queue.remove': {
      name: 'neon-dim-out',
      enterDuration: 360,
      easing: 'ease-out',
    },
    donation: {
      name: 'glow-explosion',
      enterDuration: 1100,
      easing: 'cubic-bezier(0.34, 1.6, 0.64, 1)',
      iterations: 1,
    },
  },
  cssVariables: {
    '--neon-glow-blur': '14px',
  },
  performance: {
    usesHeavyAnimation: true,
    maxFontFamilies: 4,
  },
};

// === hand-drawn ===

const handDrawnCommonDefaults: CommonOptionDefaults = {
  fontFamily: 'Nanum Pen Script',
  textWeight: 'normal',
  textColor: '#2c2c2c',
  accentColor: '#ffe082',
};

const handDrawn: ThemeCatalogEntry = {
  id: 'hand-drawn',
  name: '핸드스케치',
  tags: ['handdrawn', 'sketch', 'warm', 'organic', 'doodle'],
  description:
    '손으로 그린 노트/다이어리. 기울어진 카드와 필기체, 핀과 테이프 장식으로 따뜻한 분위기 연출.',
  thumbnail: '/themes/hand-drawn/thumbnail.svg',
  fonts: {
    roles: {
      heading: ['Caveat', 'Patrick Hand', 'Nanum Pen Script', 'cursive'],
      body: ['Patrick Hand', 'Comic Neue', 'Nanum Pen Script', 'cursive'],
      accent: ['Caveat', 'cursive'],
    },
    recommended: mergeRecommendedFonts([]),
    bundled: [
      {
        family: 'Nanum Pen Script', displayName: '나눔손글씨 펜',
        source: 'bundled',
        weights: [400],
        scripts: ['korean'],
      },
    ],
  },
  optionSchema: [
    ...buildCommonOptions(handDrawnCommonDefaults),
    {
      key: 'paperColor',
      type: 'color',
      label: '종이 컬러',
      group: 'colors',
      default: '#faf5eb',
    },
    {
      key: 'inkColor',
      type: 'color',
      label: '잉크 컬러',
      group: 'colors',
      default: '#2c2c2c',
    },
    {
      key: 'highlightColor',
      type: 'color',
      label: '형광펜 컬러',
      group: 'colors',
      default: '#ffeb3b',
    },
    {
      key: 'borderRoughness',
      type: 'range',
      label: '보더 거칠기',
      group: 'effects',
      default: 2,
      min: 1,
      max: 4,
      step: 1,
    },
    {
      key: 'tiltMax',
      type: 'range',
      label: '카드 기울기 최대값 (도)',
      group: 'layout',
      default: 2,
      min: 0,
      max: 5,
      step: 0.5,
    },
    {
      key: 'showTape',
      type: 'toggle',
      label: '테이프/핀 장식',
      group: 'effects',
      default: true,
    },
  ],
  defaultOptions: {
    showAlbumArt: true,
    ...buildCommonDefaultOptions(handDrawnCommonDefaults),
    paperColor: '#faf5eb',
    inkColor: '#2c2c2c',
    highlightColor: '#ffeb3b',
    borderRoughness: 2,
    tiltMax: 2,
    showTape: true,
  },
  presets: [
    {
      id: 'hand-drawn:notebook',
      name: 'Notebook',
      description: '크라프트 베이지 종이에 검정 잉크. 따뜻한 노트북 무드.',
      isDefault: true,
      options: {
        paperColor: '#faf5eb',
        inkColor: '#2c2c2c',
        accentColor: '#ff6b6b',
        highlightColor: '#ffeb3b',
        borderRoughness: 2,
        tiltMax: 2,
        showTape: true,
      },
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
  ],
  animations: {
    'track.change': {
      name: 'page-flip',
      enterDuration: 700,
      exitDuration: 500,
      easing: 'cubic-bezier(0.65, 0, 0.35, 1)',
    },
    'chat.enter': {
      name: 'pencil-draw',
      enterDuration: 520,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
      stagger: 80,
    },
    'chat.exit': {
      name: 'eraser-out',
      enterDuration: 320,
      easing: 'cubic-bezier(0.4, 0, 0.6, 1)',
    },
    'queue.add': {
      name: 'sticker-place',
      enterDuration: 420,
      easing: 'cubic-bezier(0.34, 1.5, 0.64, 1)',
    },
    'queue.remove': {
      name: 'sticker-peel',
      enterDuration: 360,
      easing: 'cubic-bezier(0.4, 0, 0.6, 1)',
    },
    donation: {
      name: 'star-stamp-highlight',
      enterDuration: 950,
      easing: 'cubic-bezier(0.34, 1.5, 0.64, 1)',
      iterations: 1,
    },
  },
};

// === korean-traditional ===

const koreanTraditionalCommonDefaults: CommonOptionDefaults = {
  fontFamily: 'Noto Serif KR',
  textWeight: 'normal',
  textColor: '#2c1810',
  accentColor: '#c0392b',
};

const koreanTraditional: ThemeCatalogEntry = {
  id: 'korean-traditional',
  name: '한국 전통',
  tags: ['korean', 'traditional', 'serif', 'warm', 'cultural'],
  description:
    '한국 전통 미감의 현대적 재해석. 단청, 한지, 붓글씨에서 영감을 받은 우아한 오버레이.',
  thumbnail: '/themes/korean-traditional/thumbnail.svg',
  fonts: {
    roles: {
      heading: ['Noto Serif KR', 'Nanum Myeongjo', 'serif'],
      body: ['Nanum Myeongjo', 'Noto Serif KR', 'serif'],
      accent: ['Black Han Sans', 'Noto Serif KR', 'sans-serif'],
    },
    recommended: mergeRecommendedFonts([]),
    bundled: [
      {
        family: 'Pretendard', displayName: '프리텐다드',
        source: 'bundled',
        weights: [400, 700],
        scripts: ['korean', 'latin'],
      },
    ],
  },
  optionSchema: [
    ...buildCommonOptions(koreanTraditionalCommonDefaults),
    {
      key: 'baseColor',
      type: 'color',
      label: '베이스 컬러 (한지색)',
      group: 'colors',
      default: '#f5f0e1',
    },
    {
      key: 'inkColor',
      type: 'color',
      label: '먹 컬러',
      group: 'colors',
      default: '#2c1810',
    },
    {
      key: 'accentRed',
      type: 'color',
      label: '액센트 레드 (단청)',
      group: 'colors',
      default: '#c0392b',
    },
    {
      key: 'accentBrown',
      type: 'color',
      label: '액센트 브라운 (적갈색)',
      group: 'colors',
      default: '#8b5a2b',
    },
    {
      key: 'patternStyle',
      type: 'select',
      label: '패턴 스타일',
      group: 'effects',
      default: 'border',
      choices: [
        { value: 'minimal', label: '미니멀' },
        { value: 'border', label: '보더 패턴' },
        { value: 'corner', label: '코너 모티프' },
      ],
    },
    {
      key: 'showStamp',
      type: 'toggle',
      label: '도장 표시',
      group: 'effects',
      default: true,
    },
    {
      key: 'stampText',
      type: 'text',
      label: '도장 텍스트',
      group: 'effects',
      default: '명곡',
      maxLength: 4,
    },
  ],
  defaultOptions: {
    showAlbumArt: true,
    ...buildCommonDefaultOptions(koreanTraditionalCommonDefaults),
    baseColor: '#f5f0e1',
    inkColor: '#2c1810',
    accentRed: '#c0392b',
    accentBrown: '#8b5a2b',
    patternStyle: 'border',
    showStamp: true,
    stampText: '명곡',
  },
  presets: [
    {
      id: 'korean-traditional:hanji-classic',
      name: 'Hanji Classic',
      description: '한지 종이의 따뜻한 베이지와 먹색의 조합. 가장 정통적인 한국 전통 미감.',
      isDefault: true,
      options: {
        baseColor: '#f5f0e1',
        inkColor: '#2c1810',
        accentRed: '#c0392b',
        accentBrown: '#8b5a2b',
        patternStyle: 'border',
        showStamp: true,
        stampText: '명곡',
      },
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
  ],
  animations: {
    'track.change': {
      name: 'brush-stroke',
      enterDuration: 700,
      exitDuration: 500,
      easing: 'cubic-bezier(0.65, 0, 0.35, 1)',
    },
    'chat.enter': {
      name: 'scroll-unroll',
      enterDuration: 460,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      stagger: 80,
    },
    'chat.exit': {
      name: 'scroll-roll-up',
      enterDuration: 340,
      easing: 'cubic-bezier(0.4, 0, 0.6, 1)',
    },
    'queue.add': {
      name: 'soft-fade-in',
      enterDuration: 380,
      easing: 'ease-out',
    },
    'queue.remove': {
      name: 'ink-bleed-out',
      enterDuration: 360,
      easing: 'ease-in',
    },
    donation: {
      name: 'seal-stamp-bleed',
      enterDuration: 1100,
      easing: 'cubic-bezier(0.34, 1.6, 0.64, 1)',
      iterations: 1,
    },
  },
};

// === 3d-depth ===

const threeDDepthCommonDefaults: CommonOptionDefaults = {
  fontFamily: 'NanumSquare Neo',
  textWeight: 'semibold',
  textColor: '#e2e8f0',
  accentColor: '#6366f1',
};

const threeDDepth: ThemeCatalogEntry = {
  id: '3d-depth',
  name: '3D Depth',
  tags: ['3d', 'depth', 'modern', 'shadow', 'perspective'],
  description:
    'CSS 3D 트랜스폼 기반 입체 카드. perspective와 다중 그림자로 공간감 있는 오버레이.',
  thumbnail: '/themes/3d-depth/thumbnail.svg',
  fonts: {
    roles: {
      heading: ['Inter', 'Poppins', 'Pretendard', 'sans-serif'],
      body: ['Poppins', 'Inter', 'Pretendard', 'sans-serif'],
      accent: ['Outfit', 'Inter', 'sans-serif'],
    },
    recommended: mergeRecommendedFonts([]),
    bundled: [
      {
        family: 'Pretendard', displayName: '프리텐다드',
        source: 'bundled',
        weights: [500, 700],
        scripts: ['korean', 'latin'],
      },
    ],
  },
  optionSchema: [
    ...buildCommonOptions(threeDDepthCommonDefaults),
    {
      key: 'baseColor',
      type: 'color',
      label: '베이스 컬러',
      group: 'colors',
      default: '#1e293b',
    },
    {
      key: 'highlightColor',
      type: 'color',
      label: '하이라이트',
      group: 'colors',
      default: '#a78bfa',
    },
    {
      key: 'perspective',
      type: 'range',
      label: 'Perspective (px)',
      group: 'effects',
      default: 800,
      min: 400,
      max: 1200,
      step: 10,
    },
    {
      key: 'rotateY',
      type: 'range',
      label: 'Y축 회전 (도)',
      group: 'effects',
      default: -10,
      min: -20,
      max: 20,
      step: 1,
    },
    {
      key: 'rotateX',
      type: 'range',
      label: 'X축 회전 (도)',
      group: 'effects',
      default: 5,
      min: -20,
      max: 20,
      step: 1,
    },
    {
      key: 'shadowDepth',
      type: 'range',
      label: '그림자 깊이',
      group: 'effects',
      default: 20,
      min: 8,
      max: 40,
      step: 1,
    },
  ],
  defaultOptions: {
    showAlbumArt: true,
    ...buildCommonDefaultOptions(threeDDepthCommonDefaults),
    baseColor: '#1e293b',
    highlightColor: '#a78bfa',
    perspective: 800,
    rotateY: -10,
    rotateX: 5,
    shadowDepth: 20,
  },
  presets: [
    {
      id: '3d-depth:midnight-slate',
      name: 'Midnight Slate',
      description: '슬레이트 베이스 위에 인디고/바이올렛 하이라이트. 3D 카드의 기본 프리셋.',
      isDefault: true,
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
  ],
  animations: {
    'track.change': {
      name: 'card-flip',
      enterDuration: 720,
      exitDuration: 500,
      easing: 'cubic-bezier(0.65, 0, 0.35, 1)',
    },
    'chat.enter': {
      name: '3d-slide-z',
      enterDuration: 420,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      stagger: 70,
    },
    'chat.exit': {
      name: 'z-recede',
      enterDuration: 320,
      easing: 'cubic-bezier(0.4, 0, 0.6, 1)',
    },
    'queue.add': {
      name: 'depth-step-forward',
      enterDuration: 460,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    },
    'queue.remove': {
      name: 'depth-step-back',
      enterDuration: 360,
      easing: 'cubic-bezier(0.4, 0, 0.6, 1)',
    },
    donation: {
      name: 'card-jump',
      enterDuration: 1000,
      easing: 'cubic-bezier(0.34, 1.6, 0.64, 1)',
      iterations: 1,
    },
  },
  cssVariables: {
    '--depth-perspective': '1200px',
  },
  performance: {
    uses3DTransform: true,
    maxFontFamilies: 3,
  },
};


// === apple ===

const appleCommonDefaults: CommonOptionDefaults = {
  fontFamily: 'NanumSquare Neo',
  textWeight: 'bold',
  textColor: '#FFFFFF',
  accentColor: '#FA243C',
  blurIntensity: 20,
};

const apple: ThemeCatalogEntry = {
  id: 'apple',
  name: '애플 뮤직',
  tags: ['apple', 'minimal', 'blur'],
  description:
    '미니멀, 블러 배경, 둥근 모서리. Apple Music 스타일 레이아웃.',
  thumbnail: '/themes/apple/thumbnail.png',
  fonts: {
    roles: {
      heading: ['Pretendard', 'sans-serif'],
      body: ['Pretendard', 'sans-serif'],
    },
    recommended: mergeRecommendedFonts([]),
    bundled: [
      {
        family: 'Pretendard', displayName: '프리텐다드',
        source: 'bundled',
        weights: [400, 600],
        scripts: ['korean', 'latin'],
      },
    ],
  },
  optionSchema: buildCommonOptions(appleCommonDefaults),
  defaultOptions: {
    ...buildCommonDefaultOptions(appleCommonDefaults),
    showAlbumArt: true,
  },
  presets: [
    {
      id: 'apple:default',
      name: 'Apple Music — 기본',
      description: '기본 Apple Music 레이아웃.',
      options: {},
      isDefault: true,
    },
  ],
  animations: {
    'track.change': {
      name: 'fade',
      enterDuration: 300,
      exitDuration: 200,
      easing: 'ease-out',
    },
    'chat.enter': { name: 'fade', enterDuration: 300, easing: 'ease-out' },
    'chat.exit': { name: 'fade', enterDuration: 200, easing: 'ease-out' },
    'queue.add': { name: 'fade', enterDuration: 300, easing: 'ease-out' },
    'queue.remove': { name: 'fade', enterDuration: 200, easing: 'ease-out' },
    donation: { name: 'fade', enterDuration: 300, easing: 'ease-out' },
  },
};

// === spotify ===

const spotifyCommonDefaults: CommonOptionDefaults = {
  fontFamily: 'NanumSquare Neo',
  textWeight: 'bold',
  textColor: '#FFFFFF',
  accentColor: '#1DB954',
};

const spotify: ThemeCatalogEntry = {
  id: 'spotify',
  name: '스포티파이',
  tags: ['spotify', 'dark', 'green'],
  description:
    '다크 테마, 녹색 강조, 두꺼운 진행바. Spotify 스타일 레이아웃.',
  thumbnail: '/themes/spotify/thumbnail.png',
  fonts: {
    roles: {
      heading: ['Pretendard', 'sans-serif'],
      body: ['Pretendard', 'sans-serif'],
    },
    recommended: mergeRecommendedFonts([]),
    bundled: [
      {
        family: 'Pretendard', displayName: '프리텐다드',
        source: 'bundled',
        weights: [400, 600],
        scripts: ['korean', 'latin'],
      },
    ],
  },
  optionSchema: buildCommonOptions(spotifyCommonDefaults),
  defaultOptions: {
    ...buildCommonDefaultOptions(spotifyCommonDefaults),
    showAlbumArt: true,
  },
  presets: [
    {
      id: 'spotify:default',
      name: 'Spotify — 기본',
      description: '기본 Spotify 레이아웃.',
      options: {},
      isDefault: true,
    },
  ],
  animations: {
    'track.change': {
      name: 'fade',
      enterDuration: 300,
      exitDuration: 200,
      easing: 'ease-out',
    },
    'chat.enter': { name: 'fade', enterDuration: 300, easing: 'ease-out' },
    'chat.exit': { name: 'fade', enterDuration: 200, easing: 'ease-out' },
    'queue.add': { name: 'fade', enterDuration: 300, easing: 'ease-out' },
    'queue.remove': { name: 'fade', enterDuration: 200, easing: 'ease-out' },
    donation: { name: 'fade', enterDuration: 300, easing: 'ease-out' },
  },
};

// === billboard ===

const billboardCommonDefaults: CommonOptionDefaults = {
  fontFamily: 'NanumSquare Neo',
  textWeight: 'bold',
  textColor: '#FFFFFF',
  accentColor: '#A78BFA',
};

const billboard: ThemeCatalogEntry = {
  id: 'billboard',
  name: '빌보드',
  tags: ['billboard', 'bold', 'text-only', 'transparent'],
  description:
    '투명 배경, 큰 Bold 텍스트만. Billboard 스타일 레이아웃.',
  thumbnail: '/themes/billboard/thumbnail.png',
  fonts: {
    roles: {
      heading: ['Pretendard', 'sans-serif'],
      body: ['Pretendard', 'sans-serif'],
    },
    recommended: mergeRecommendedFonts([]),
    bundled: [
      {
        family: 'Pretendard', displayName: '프리텐다드',
        source: 'bundled',
        weights: [400, 600],
        scripts: ['korean', 'latin'],
      },
    ],
  },
  optionSchema: [
    ...buildCommonOptions(billboardCommonDefaults),
    {
      key: 'titleLineClamp',
      type: 'range',
      label: '현재 재생 곡 제목 줄 수',
      group: 'common',
      default: 1,
      min: 1,
      max: 3,
      step: 1,
      helpText: '1줄이면 말줄임표(…)로 잘림, 2줄 이상이면 해당 줄 수까지 표시 후 말줄임표.',
    },
    {
      key: 'setlistNowPlayingBg',
      type: 'color',
      label: 'NOW PLAYING 배경 (셋리스트)',
      group: 'colors',
      default: '#3A3A3A',
    },
  ],
  defaultOptions: {
    showAlbumArt: true,
    ...buildCommonDefaultOptions(billboardCommonDefaults),
    titleLineClamp: 1,
    setlistNowPlayingBg: '#3A3A3A',
    // billboard 는 투명 배경 + 큰 흰 글자만 깔리는 특수 케이스라 외곽선이
    // 사실상 필수. 옵션 자체는 끌 수 있도록 두지만 default 는 ON 으로
    // 강제 (다른 테마들의 default false 위에 올라타는 override).
    textStrokeEnabled: true,
  },
  presets: [
    {
      id: 'billboard:default',
      name: 'Billboard — 기본',
      description: '기본 Billboard 레이아웃.',
      options: {},
      isDefault: true,
    },
  ],
  animations: {
    'track.change': {
      name: 'fade',
      enterDuration: 300,
      exitDuration: 200,
      easing: 'ease-out',
    },
    'chat.enter': { name: 'fade', enterDuration: 300, easing: 'ease-out' },
    'chat.exit': { name: 'fade', enterDuration: 200, easing: 'ease-out' },
    'queue.add': { name: 'fade', enterDuration: 300, easing: 'ease-out' },
    'queue.remove': { name: 'fade', enterDuration: 200, easing: 'ease-out' },
    donation: { name: 'fade', enterDuration: 300, easing: 'ease-out' },
  },
};

// === Sports Ticker ===
// TV broadcast lower-third with a scrolling ticker bar and blinking
// LIVE indicator. Matches the meloming-overlay/themes/sports-ticker
// runtime config 1:1.
const sportsTicker: ThemeCatalogEntry = {
  id: 'sports-ticker',
  name: 'Sports Ticker / Broadcast',
  tags: ['sports', 'broadcast', 'news', 'professional', 'ticker'],
  description:
    'TV 방송국 로어 써드 스타일. LIVE 뱃지와 흐르는 티커, 뉴스 채널 같은 풀폭 하단 바.',
  thumbnail: '/themes/sports-ticker/thumbnail.svg',
  fonts: {
    roles: {
      heading: ['Inter', 'Roboto Condensed', 'Barlow', 'sans-serif'],
      body: ['Roboto Condensed', 'Inter', 'Barlow', 'sans-serif'],
      accent: ['Barlow', 'Inter', 'sans-serif'],
    },
    recommended: [
      { family: 'Inter', source: 'google', weights: [400, 700, 900], scripts: ['latin'] },
      { family: 'Roboto Condensed', source: 'google', weights: [400, 700], scripts: ['latin'] },
      { family: 'Barlow', source: 'google', weights: [400, 700, 900], scripts: ['latin'] },
    ],
    bundled: [],
  },
  optionSchema: [
    { key: 'brandColor', type: 'color', default: '#c0392b', label: 'Brand color (LIVE / accent strip)', group: 'colors' },
    { key: 'accentColor', type: 'color', default: '#1a1a2e', label: 'Accent color (ticker bar)', group: 'colors' },
    { key: 'textColor', type: 'color', default: '#ffffff', label: 'Text color', group: 'colors' },
    { key: 'backgroundColor', type: 'color', default: '#0a0a1a', label: 'Background', group: 'colors' },
    { key: 'tickerSpeed', type: 'range', default: 14, min: 6, max: 30, label: 'Ticker scroll speed (sec)', group: 'effects' },
    { key: 'liveBlinkSpeed', type: 'range', default: 1.5, min: 0.5, max: 3, step: 0.5, label: 'LIVE blink speed (sec)', group: 'effects' },
    { key: 'showLiveIndicator', type: 'toggle', default: true, label: 'Show LIVE indicator', group: 'effects' },
  ],
  defaultOptions: {
    brandColor: '#c0392b',
    accentColor: '#1a1a2e',
    textColor: '#ffffff',
    tickerSpeed: 14,
    liveBlinkSpeed: 1.5,
    showLiveIndicator: true,
    backgroundColor: '#0a0a1a',
  },
  presets: [
    {
      id: 'sports-ticker:news-desk',
      name: 'News Desk',
      description: '클래식 뉴스 데스크. 브로드캐스트 레드 + 네이비.',
      isDefault: true,
      options: { brandColor: '#c0392b', accentColor: '#1a1a2e', textColor: '#ffffff', tickerSpeed: 14, liveBlinkSpeed: 1.5, showLiveIndicator: true, backgroundColor: '#0a0a1a' },
    },
    {
      id: 'sports-ticker:sports-bar',
      name: 'Sports Bar',
      description: '스포츠 중계 느낌. 짙은 블루와 옐로우 포인트.',
      options: { brandColor: '#1e3a8a', accentColor: '#fbbf24', textColor: '#ffffff', tickerSpeed: 14, liveBlinkSpeed: 1.5, showLiveIndicator: true, backgroundColor: '#0a0a1a' },
    },
    {
      id: 'sports-ticker:election-night',
      name: 'Election Night',
      description: '선거 개표 방송 스타일. 강렬한 레드/블루 대비.',
      options: { brandColor: '#dc2626', accentColor: '#1d4ed8', textColor: '#ffffff', tickerSpeed: 14, liveBlinkSpeed: 1.5, showLiveIndicator: true, backgroundColor: '#0a0a1a' },
    },
    {
      id: 'sports-ticker:weather-channel',
      name: 'Weather Channel',
      description: '24시간 기상 채널 톤. 시안 블루 베이스.',
      options: { brandColor: '#0ea5e9', accentColor: '#0c4a6e', textColor: '#ffffff', tickerSpeed: 14, liveBlinkSpeed: 1.5, showLiveIndicator: true, backgroundColor: '#0a0a1a' },
    },
  ],
  animations: {
    'track.change': { name: 'slide-up', enterDuration: 500, exitDuration: 300 },
    'chat.enter': { name: 'ticker-scroll-in', enterDuration: 400, stagger: 60 },
    'chat.exit': { name: 'scroll-out', enterDuration: 300 },
    'queue.add': { name: 'banner-slide', enterDuration: 450, stagger: 80 },
    'queue.remove': { name: 'banner-slide-out', enterDuration: 300 },
    donation: { name: 'breaking-banner', enterDuration: 1200, iterations: 1 },
  },
  cssVariables: {
    '--sports-ticker-brand': '#c0392b',
    '--sports-ticker-accent': '#1a1a2e',
    '--sports-ticker-text': '#ffffff',
    '--sports-ticker-bg': '#0a0a1a',
  },
  performance: { maxFontFamilies: 2 },
};

// === Concert Poster ===
// Meloming-branded concert poster theme. Bold typography, soft drop
// shadow, vertical accent bar, IBM Plex Sans / KR / JP for tri-script
// song titles. Matches meloming-overlay/themes/concert-poster.
const concertPoster: ThemeCatalogEntry = {
  id: 'concert-poster',
  name: 'Concert Poster',
  tags: ['poster', 'bold', 'purple', 'high-contrast', 'typographic', 'event'],
  description:
    '콘서트 포스터/페스티벌 라인업 톤. 보라 액센트 + 부드러운 드롭 섀도우 + 액센트 stroke. 곡명 강조 + REQUESTED BY + NEXT 표기.',
  thumbnail: '/themes/concert-poster/thumbnail.svg',
  fonts: {
    roles: {
      heading: ['IBM Plex Sans', 'IBM Plex Sans KR', 'IBM Plex Sans JP', 'Pretendard', 'sans-serif'],
      body: ['IBM Plex Sans', 'IBM Plex Sans KR', 'IBM Plex Sans JP', 'Pretendard', 'sans-serif'],
    },
    recommended: [
      { family: 'IBM Plex Sans', source: 'google', weights: [400, 500, 600, 700], scripts: ['latin'] },
      { family: 'IBM Plex Sans KR', source: 'google', weights: [400, 500, 600, 700], scripts: ['korean'] },
      { family: 'IBM Plex Sans JP', source: 'google', weights: [400, 500, 600, 700], scripts: ['japanese'] },
      { family: 'Pretendard', displayName: '프리텐다드', source: 'google', weights: [400, 700, 900], scripts: ['latin', 'korean'] },
    ],
    bundled: [],
  },
  optionSchema: [
    { key: 'accentColor', type: 'color', default: '#7B5BFF', label: '액센트 (보라)', group: 'colors' },
    { key: 'titleColor', type: 'color', default: '#FAF8FF', label: '곡명 컬러', group: 'colors' },
    { key: 'textColor', type: 'color', default: '#D9D2FF', label: '아티스트 / 본문 컬러', group: 'colors' },
    { key: 'mutedColor', type: 'color', default: '#7C7791', label: '보조 텍스트 컬러', group: 'colors' },
    { key: 'shadowOffset', type: 'range', default: 2, min: 1, max: 6, label: '외곽선 두께 (px)', group: 'effects' },
    { key: 'shadowColor', type: 'color', default: '#160B33', label: '외곽선 컬러', group: 'effects' },
  ],
  defaultOptions: {
    accentColor: '#7B5BFF',
    titleColor: '#FAF8FF',
    textColor: '#D9D2FF',
    shadowOffset: 2,
    shadowColor: '#160B33',
    mutedColor: '#7C7791',
  },
  presets: [
    {
      id: 'concert-poster:meloming',
      name: '멜로밍 보라',
      description: '브랜드 보라 + 부드러운 글로우. 기본값.',
      isDefault: true,
      options: { accentColor: '#7B5BFF', titleColor: '#FAF8FF', textColor: '#D9D2FF', shadowOffset: 2, shadowColor: '#160B33', mutedColor: '#7C7791' },
    },
    {
      id: 'concert-poster:midnight',
      name: '미드나잇 블루',
      description: '심야 라이브 톤. 차분한 인디고 액센트.',
      options: { accentColor: '#5B6CFF', titleColor: '#F2F4FF', textColor: '#C5CCFF', shadowOffset: 2, shadowColor: '#0A0E2A', mutedColor: '#7C7791' },
    },
    {
      id: 'concert-poster:peach',
      name: '피치 글로우',
      description: '따뜻한 살구 + 코랄 톤. 데이타임 라이브용.',
      options: { accentColor: '#FF8FA3', titleColor: '#FFF6F1', textColor: '#FFD6CD', shadowOffset: 2, shadowColor: '#3D1320', mutedColor: '#7C7791' },
    },
    {
      id: 'concert-poster:mint',
      name: '민트 라임',
      description: '청량한 민트 톤. 가벼운 분위기 매칭.',
      options: { accentColor: '#4DD4B5', titleColor: '#F1FFFB', textColor: '#B5F1E2', shadowOffset: 2, shadowColor: '#0E2A24', mutedColor: '#7C7791' },
    },
  ],
  animations: {
    'track.change': { name: 'poster-slide', enterDuration: 320, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    'chat.enter': { name: 'poster-stamp', enterDuration: 220, stagger: 35 },
    'chat.exit': { name: 'poster-fade-out', enterDuration: 140 },
    'queue.add': { name: 'poster-slide-in', enterDuration: 260, stagger: 50 },
    'queue.remove': { name: 'poster-fade-out', enterDuration: 160 },
    donation: { name: 'poster-spotlight', enterDuration: 600, iterations: 1 },
  },
  cssVariables: {
    '--concert-poster-accent': '#7B5BFF',
    '--concert-poster-title': '#FAF8FF',
    '--concert-poster-text': '#D9D2FF',
  },
  performance: { maxFontFamilies: 4 },
};

// === Catalog ===

/**
 * Recursively `Object.freeze`s a value and every nested object/array reachable
 * from it. Used at module load time to make the theme catalog immutable so any
 * attempt to mutate it (in strict mode) throws instead of silently corrupting
 * shared state across requests.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/**
 * Themes keyed by id for O(1) lookup. Use {@link THEME_CATALOG_LIST} when
 * iteration order matters (matches the THEME_IDS declaration order).
 *
 * The catalog is deep-frozen at module load — mutating any nested entry
 * (e.g. `THEME_CATALOG.kawaii.optionSchema.push(...)`) will throw in strict
 * mode. Treat it as a static, immutable source of truth.
 */
export const THEME_CATALOG: Readonly<Record<ThemeId, ThemeCatalogEntry>> =
  deepFreeze({
    apple,
    spotify,
    billboard,
    'retro-pixel': retroPixel,
    glassmorphism,
    brutalist,
    kawaii,
    'vinyl-analog': vinylAnalog,
    'neon-cyberpunk': neonCyberpunk,
    'hand-drawn': handDrawn,
    'korean-traditional': koreanTraditional,
    '3d-depth': threeDDepth,
    'sports-ticker': sportsTicker,
    'concert-poster': concertPoster,
  });

export const THEME_CATALOG_LIST: readonly ThemeCatalogEntry[] = Object.freeze(
  THEME_IDS.map((id) => THEME_CATALOG[id]),
);

export function getThemeCatalogEntry(
  id: string,
): ThemeCatalogEntry | undefined {
  return THEME_CATALOG[id as ThemeId];
}

/** Returns true when the catalog contains a theme with the given id. */
export function hasCatalogTheme(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(THEME_CATALOG, id);
}

/** Returns all built-in presets across every theme in the catalog. */
export function getAllBuiltInPresets(): ThemePreset[] {
  return THEME_CATALOG_LIST.flatMap((theme) => theme.presets);
}

/** Returns the default preset for a given theme, if any. */
export function getDefaultPreset(themeId: string): ThemePreset | undefined {
  const theme = getThemeCatalogEntry(themeId);
  if (!theme) {
    return undefined;
  }
  return theme.presets.find((preset) => preset.isDefault) ?? theme.presets[0];
}

/** Re-export `FontEntry` so consumers can import it from the catalog file. */
export type { FontEntry, OptionField, ThemePreset, ThemeSubtheme };
