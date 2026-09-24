export const THEME_IDS = [
  'apple',
  'spotify',
  'billboard',
  'retro-pixel',
  'glassmorphism',
  'brutalist',
  'kawaii',
  'vinyl-analog',
  'neon-cyberpunk',
  'hand-drawn',
  'korean-traditional',
  '3d-depth',
  'sports-ticker',
  'concert-poster',
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export type AnyThemeId = ThemeId;

export const ALL_THEME_IDS: readonly AnyThemeId[] = [...THEME_IDS];

export function isValidThemeId(value: string): value is AnyThemeId {
  return ALL_THEME_IDS.includes(value as AnyThemeId);
}
