// Layout Types
//
// Note: this union has been widened to include the 9 diversification catalog
// theme ids in addition to the 3 core layouts. The core layouts (`apple`,
// `spotify`, `billboard`) still have dedicated React components and metadata
// below; the other theme ids are loaded dynamically from the theme registry
// (see `domains/overlay/themes/registry.ts`). They appear here so that
// widget pages and saved widget configs can hold them as `layoutType` state
// without being coerced back to `apple` by `isValidLayoutType`.
export const LAYOUT_TYPES = [
  // Core layouts (have dedicated NowPlayingApple/Spotify/Billboard
  // components plus QueueWidgetView).
  'apple',
  'spotify',
  'billboard',
  // Diversification catalog themes — rendered via the theme registry.
  'retro-pixel',
  'glassmorphism',
  'brutalist',
  'kawaii',
  'vinyl-analog',
  'neon-cyberpunk',
  'hand-drawn',
  'korean-traditional',
  '3d-depth',
] as const;
export type LayoutType = (typeof LAYOUT_TYPES)[number];

export const DEFAULT_LAYOUT: LayoutType = 'apple';

export function isValidLayoutType(value: string): value is LayoutType {
  return LAYOUT_TYPES.includes(value as LayoutType);
}

// Layout metadata
//
// Only the 3 legacy layouts have static metadata here. The Phase 3 catalog
// themes load their metadata (name, description, thumbnail, etc.) from the
// theme registry, so this map is intentionally `Partial<...>` to avoid
// requiring entries for them.
export interface LayoutMetadata {
  key: LayoutType;
  name: string;
  description: string;
  emoji: string;
}

export const LAYOUT_METADATA: Partial<Record<LayoutType, LayoutMetadata>> = {
  apple: {
    key: 'apple',
    name: 'Apple Music',
    description: '미니멀, 블러 배경, 둥근 모서리',
    emoji: '🍎',
  },
  spotify: {
    key: 'spotify',
    name: 'Spotify',
    description: '다크 테마, 녹색 강조, 두꺼운 진행바',
    emoji: '🟢',
  },
  billboard: {
    key: 'billboard',
    name: 'Billboard',
    description: '투명 배경, 큰 Bold 텍스트만',
    emoji: '📊',
  },
};
