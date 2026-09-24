import type { ThemeDefinition } from './types';
import { ALL_THEME_IDS, type AnyThemeId } from './types';

// Lazy theme loaders — each theme is dynamically imported
type ThemeLoader = () => Promise<{ default: ThemeDefinition }>;

const themeLoaders: Record<string, ThemeLoader> = {
  'apple': () => import('./apple'),
  'spotify': () => import('./spotify'),
  'billboard': () => import('./billboard'),
  'retro-pixel': () => import('./retro-pixel'),
  'glassmorphism': () => import('./glassmorphism'),
  'brutalist': () => import('./brutalist'),
  'kawaii': () => import('./kawaii'),
  'vinyl-analog': () => import('./vinyl-analog'),
  'neon-cyberpunk': () => import('./neon-cyberpunk'),
  'hand-drawn': () => import('./hand-drawn'),
  'korean-traditional': () => import('./korean-traditional'),
  '3d-depth': () => import('./3d-depth'),
  'sports-ticker': () => import('./sports-ticker'),
  'concert-poster': () => import('./concert-poster'),
};

const themeCache = new Map<string, ThemeDefinition>();

export const DEFAULT_FALLBACK_THEME_ID: AnyThemeId = 'apple';

/** Load a theme by id. Returns null if not found. Caches successful loads. */
export async function loadTheme(themeId: string): Promise<ThemeDefinition | null> {
  if (themeCache.has(themeId)) {
    return themeCache.get(themeId)!;
  }

  const loader = themeLoaders[themeId];
  if (!loader) return null;

  try {
    const themeModule = await loader();
    const theme = themeModule.default;
    themeCache.set(themeId, theme);
    return theme;
  } catch (error) {
    console.error(`[theme-registry] Failed to load theme: ${themeId}`, error);
    return null;
  }
}

/** Load a theme with fallback to `DEFAULT_FALLBACK_THEME_ID` if not found. */
export async function loadThemeWithFallback(themeId: string): Promise<ThemeDefinition> {
  const theme = await loadTheme(themeId);
  if (theme) return theme;

  console.warn(`[theme-registry] Theme not found: ${themeId}, falling back to ${DEFAULT_FALLBACK_THEME_ID}`);
  const fallback = await loadTheme(DEFAULT_FALLBACK_THEME_ID);
  if (!fallback) {
    throw new Error(`[theme-registry] Default fallback theme '${DEFAULT_FALLBACK_THEME_ID}' is not available`);
  }
  return fallback;
}

/** List all available theme IDs. */
export function listThemeIds(): readonly AnyThemeId[] {
  return ALL_THEME_IDS;
}

/** Check if a theme is loadable (registered). */
export function hasTheme(themeId: string): boolean {
  return themeId in themeLoaders;
}

/** Clear cache (for testing or theme hot-reload). */
export function clearThemeCache(): void {
  themeCache.clear();
}
