/**
 * Public surface of the overlay theme manifest.
 *
 * Consumers should import from this barrel rather than reaching into
 * individual files. Example:
 *
 *   import {
 *     THEME_IDS,
 *     ThemeCatalogEntry,
 *     getThemeCatalogEntry,
 *   } from '../theme-manifest.js';
 */

export * from './theme-ids.js';
export * from './widget-types.js';
export * from './animation-events.js';
export * from './types.js';
export {
  THEME_CATALOG,
  THEME_CATALOG_LIST,
  getThemeCatalogEntry,
  hasCatalogTheme,
  getAllBuiltInPresets,
  getDefaultPreset,
} from './catalog.js';
