#!/usr/bin/env node
// Theme conformance checker for meloming-overlay.
//
// Validates each theme definition under `domains/overlay/themes/*` against the
// requirements baked into the shared theme manifest and documented in the
// implementation plan. This is a standalone Node script (no test framework)
// that uses the already-installed `typescript` dev dependency to transpile
// each theme's config.ts on the fly and evaluate the resulting plain JS.
//
// Usage:
//   pnpm check:themes
//   node scripts/check-themes.mjs
//
// Exit code 0 = all themes conform. Exit code 1 = at least one theme has
// conformance issues.

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const THIS_FILE = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(THIS_FILE), '..');
const THEMES_DIR = join(PROJECT_ROOT, 'domains', 'overlay', 'themes');

/** Every theme must ship an animation for all six events. */
const REQUIRED_ANIMATION_EVENTS = [
  'track.change',
  'chat.enter',
  'chat.exit',
  'queue.add',
  'queue.remove',
  'donation',
];

/** Final fallback families a font role chain must end with. */
const GENERIC_FONT_FAMILIES = new Set([
  'sans-serif',
  'serif',
  'monospace',
  'cursive',
  'system-ui',
]);

/** Required widget keys on ThemeDefinition.widgets. */
const REQUIRED_WIDGET_KEYS = ['now-playing', 'queue', 'chatbox', 'setlist'];

/** Required top-level fields on a ThemeDefinition. */
const REQUIRED_THEME_FIELDS = [
  'id',
  'name',
  'tags',
  'description',
  'thumbnail',
  'widgets',
  'fonts',
  'optionSchema',
  'defaultOptions',
  'presets',
  'animations',
];

/** Config-backed theme directory ids checked by this script. */
const THEME_IDS = [
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
];

// -----------------------------------------------------------------------------
// TypeScript transpilation helpers
// -----------------------------------------------------------------------------

/**
 * Transpile a TypeScript source string to ES module JavaScript. `import type`
 * declarations are fully erased, so a file whose only imports are type-only
 * becomes a self-contained module that can be loaded via a data URL.
 */
function transpileTsToJs(source, fileName) {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
      verbatimModuleSyntax: false,
      isolatedModules: true,
    },
    fileName,
    reportDiagnostics: false,
  });
  return result.outputText;
}

/**
 * Strip any remaining runtime `import` statement from a transpiled ES module.
 * After `import type` erasure the only remaining imports in a theme config
 * are pure re-exports.
 */
function stripRuntimeImports(js) {
  return js.replace(/^\s*import\s+[^;]*?;\s*$/gm, '');
}

/** Load a transpiled module from a data URL and return its namespace. */
async function loadDataUrlModule(js) {
  const dataUrl =
    'data:text/javascript;base64,' + Buffer.from(js).toString('base64');
  return await import(dataUrl);
}

// -----------------------------------------------------------------------------
// Theme loading
// -----------------------------------------------------------------------------

/**
 * Load a theme's config exports (defaultOptions, presets, fonts, animations,
 * optionSchema, etc.) by transpiling `config.ts` from source.
 */
async function loadThemeConfig(themeId) {
  const configPath = join(THEMES_DIR, themeId, 'config.ts');
  const configSource = await readFile(configPath, 'utf8');
  let transpiled = transpileTsToJs(configSource, configPath);

  transpiled = stripRuntimeImports(transpiled);

  const ns = await loadDataUrlModule(transpiled);
  // Named exports are primary, but fall back to the default combined object.
  return {
    defaultOptions: ns.defaultOptions ?? ns.default?.defaultOptions,
    presets: ns.presets ?? ns.default?.presets,
    fonts: ns.fonts ?? ns.default?.fonts,
    animations: ns.animations ?? ns.default?.animations,
    optionSchema: ns.optionSchema ?? ns.default?.optionSchema,
  };
}

/**
 * Parse the essential fields (id, name, tags, description, thumbnail, widgets
 * keys) out of an `index.ts` file. We don't evaluate it because it imports real
 * .tsx widget components that need a React runtime. Text inspection is enough
 * because every theme follows the same shape.
 */
async function loadThemeIndexMeta(themeId) {
  const indexPath = join(THEMES_DIR, themeId, 'index.ts');
  const source = await readFile(indexPath, 'utf8');

  const pickString = (key) => {
    const re = new RegExp(`${key}\\s*:\\s*(?:'([^']*)'|"([^"]*)")`, 'm');
    const match = source.match(re);
    return match ? (match[1] ?? match[2]) : undefined;
  };

  const id = pickString('id');
  const name = pickString('name');
  const thumbnail = pickString('thumbnail');

  // tags: ['a', 'b', 'c']
  const tagsMatch = source.match(/tags\s*:\s*\[([^\]]*)\]/m);
  let tags;
  if (tagsMatch) {
    tags = [...tagsMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
  }

  // description may span multiple lines or use template strings.
  const descMatch = source.match(
    /description\s*:\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/m,
  );
  const description = descMatch
    ? (descMatch[1] ?? descMatch[2] ?? descMatch[3])
    : undefined;

  // widgets block — collect the keys between braces.
  const widgetsMatch = source.match(/widgets\s*:\s*\{([^}]*)\}/m);
  let widgetKeys = [];
  if (widgetsMatch) {
    const body = widgetsMatch[1];
    const keyRe =
      /(?:^|,|\{)\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_][A-Za-z0-9_-]*))\s*:/g;
    let m;
    while ((m = keyRe.exec(body)) !== null) {
      widgetKeys.push(m[1] ?? m[2] ?? m[3]);
    }
  }

  return { id, name, tags, description, thumbnail, widgetKeys };
}

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

export function validateTheme(themeId, meta, config) {
  const issues = [];

  // (a) Required top-level fields
  const definition = {
    id: meta.id,
    name: meta.name,
    tags: meta.tags,
    description: meta.description,
    thumbnail: meta.thumbnail,
    widgets:
      meta.widgetKeys && meta.widgetKeys.length ? meta.widgetKeys : undefined,
    fonts: config.fonts,
    optionSchema: config.optionSchema,
    defaultOptions: config.defaultOptions,
    presets: config.presets,
    animations: config.animations,
  };
  for (const field of REQUIRED_THEME_FIELDS) {
    if (definition[field] === undefined || definition[field] === null) {
      issues.push(`Missing required field: ${field}`);
    }
  }

  // (b) id matches directory name
  if (meta.id !== undefined && meta.id !== themeId) {
    issues.push(`id "${meta.id}" does not match directory name "${themeId}"`);
  }

  // (c) tags is a non-empty array
  if (!Array.isArray(meta.tags) || meta.tags.length === 0) {
    issues.push('tags must be a non-empty array');
  }

  // (d) fonts.roles values are arrays (not strings)
  // (e) Each font role chain ends with a generic CSS family.
  if (
    config.fonts &&
    config.fonts.roles &&
    typeof config.fonts.roles === 'object'
  ) {
    for (const [role, value] of Object.entries(config.fonts.roles)) {
      if (!Array.isArray(value)) {
        issues.push(
          `fonts.roles.${role} must be an array (got ${typeof value})`,
        );
        continue;
      }
      if (value.length === 0) {
        issues.push(`fonts.roles.${role} is empty`);
        continue;
      }
      const last = value[value.length - 1];
      if (typeof last !== 'string' || !GENERIC_FONT_FAMILIES.has(last)) {
        issues.push(
          `fonts.roles.${role} must end with a generic CSS family ` +
            `(sans-serif/serif/monospace/cursive/system-ui); got "${last}"`,
        );
      }
    }
  } else if (config.fonts !== undefined) {
    issues.push('fonts.roles missing or not an object');
  }

  // (f) optionSchema keys exactly match defaultOptions keys
  if (
    Array.isArray(config.optionSchema) &&
    config.defaultOptions &&
    typeof config.defaultOptions === 'object'
  ) {
    const schemaKeys = new Set(config.optionSchema.map((field) => field.key));
    const defaultKeys = new Set(Object.keys(config.defaultOptions));
    for (const key of schemaKeys) {
      if (!defaultKeys.has(key)) {
        issues.push(
          `optionSchema key "${key}" has no matching defaultOptions entry`,
        );
      }
    }
    for (const key of defaultKeys) {
      if (!schemaKeys.has(key)) {
        issues.push(
          `defaultOptions key "${key}" has no matching optionSchema entry`,
        );
      }
    }
  }

  // (g) All 6 animation events defined
  if (config.animations && typeof config.animations === 'object') {
    for (const event of REQUIRED_ANIMATION_EVENTS) {
      if (!(event in config.animations)) {
        issues.push(`Missing animation event: ${event}`);
      }
    }
  }

  // (h) Each preset id follows `{themeId}:{slug}` format.
  // (i) At least one preset is marked isDefault.
  if (Array.isArray(config.presets)) {
    const prefix = `${themeId}:`;
    let hasDefault = false;
    for (const preset of config.presets) {
      if (
        typeof preset.id !== 'string' ||
        !preset.id.startsWith(prefix) ||
        preset.id.length <= prefix.length
      ) {
        issues.push(
          `Preset id "${preset.id}" does not follow "${themeId}:{slug}" format`,
        );
      }
      if (preset.isDefault === true) hasDefault = true;
    }
    if (!hasDefault) {
      issues.push('No preset is marked isDefault');
    }
  }

  // (j) widgets has all 3 keys: now-playing, queue, chatbox
  if (meta.widgetKeys) {
    const seen = new Set(meta.widgetKeys);
    for (const key of REQUIRED_WIDGET_KEYS) {
      if (!seen.has(key)) {
        issues.push(`widgets is missing required key "${key}"`);
      }
    }
  }

  return issues;
}

// -----------------------------------------------------------------------------
// Font registry consistency
// -----------------------------------------------------------------------------
//
// Catalog의 family 이름과 overlay.css의 @font-face 정의 family가 어긋나면
// 사용자가 picker에서 폰트를 선택해도 silent fail (2026-04-27 사고 원인).
// 같은 클래스 결함 재발 방지를 위해 다음을 검증한다:
//
// 1. font-loader.ts의 LOCAL_GOOGLE_FONT_FAMILIES map과 overlay.css의
//    @font-face family 정의가 disjoint (둘 다 정의되면 cascade 충돌)
// 2. 사용 안 되는 dead @font-face 정의 경고 (catalog snapshot mirror가 있을
//    때만 활성. 5-B에서 추가 예정)

const OVERLAY_CSS_PATH = join(PROJECT_ROOT, 'app', 'overlay.css');
const FONT_LOADER_PATH = join(
  PROJECT_ROOT,
  'domains',
  'overlay',
  'themes',
  'shared',
  'font-loader.ts',
);
const CATALOG_MIRROR_PATH = join(
  PROJECT_ROOT,
  'scripts',
  'catalog-font-mirror.json',
);

async function parseOverlayCssFontFaces() {
  const content = await readFile(OVERLAY_CSS_PATH, 'utf-8');
  const families = new Set();
  const matches = content.matchAll(
    /@font-face\s*\{[^}]*?font-family\s*:\s*['"]([^'"]+)['"]/g,
  );
  for (const m of matches) {
    families.add(m[1]);
  }
  return families;
}

// overlay.css의 Google Fonts CSS2 @import URL에서 family 이름 추출.
// 예: ?family=Press+Start+2P&family=Orbitron:wght@400;500
//   → 'Press Start 2P', 'Orbitron'
async function parseOverlayCssGoogleImports() {
  const content = await readFile(OVERLAY_CSS_PATH, 'utf-8');
  const families = new Set();
  const importMatches = content.matchAll(
    /@import\s+url\(['"]https:\/\/fonts\.googleapis\.com\/css2\?([^'"]+)['"]\)/g,
  );
  for (const im of importMatches) {
    const query = im[1];
    const familyMatches = query.matchAll(/family=([^&:]+)/g);
    for (const fm of familyMatches) {
      const decoded = decodeURIComponent(fm[1]).replace(/\+/g, ' ');
      families.add(decoded);
    }
  }
  return families;
}

async function parseFontLoaderGoogleFamilies() {
  const content = await readFile(FONT_LOADER_PATH, 'utf-8');
  const families = new Set();
  const mapMatch = content.match(
    /const\s+LOCAL_GOOGLE_FONT_FAMILIES\s*=\s*new\s+Map<string,\s*string>\(\[([\s\S]*?)\]\)/,
  );
  if (!mapMatch) {
    return null;
  }
  const body = mapMatch[1];
  const matches = body.matchAll(
    /\[\s*['"]([^'"]+)['"]\s*,\s*['"][^'"]+['"]\s*\]/g,
  );
  for (const m of matches) {
    families.add(m[1]);
  }
  return families;
}

async function loadCatalogMirror() {
  const content = await readFile(CATALOG_MIRROR_PATH, 'utf-8');
  return JSON.parse(content);
}

// overlay.css의 외부 CSS @import가 정의하는 family. parser가 외부 CSS 안의
// @font-face는 따라 들어가지 못하므로, 새 외부 CSS @import를 추가할 때만
// 이 set에 명시 mirror한다. 현재 bundled fonts는 직접 @font-face로 정의한다.
const KNOWN_EXTERNAL_IMPORT_FAMILIES = new Set([]);

const SYSTEM_ROLE_FAMILIES = new Set([
  'Arial',
  'Arial Black',
  'Helvetica',
  'Helvetica Bold',
  'SF Pro',
  'SF Pro Display',
]);

function normalizeCssFamily(family) {
  return String(family).trim().replace(/^(['"])(.*)\1$/, '$2');
}

async function collectThemeFontFamilies() {
  const issues = [];
  const roleFamilies = new Set();
  const recommendedGoogleFamilies = new Set();
  const bundledFamilies = new Set();

  for (const themeId of THEME_IDS) {
    let config;
    try {
      config = await loadThemeConfig(themeId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push(`theme font config load failed for ${themeId}: ${message}`);
      continue;
    }

    const fonts = config.fonts;
    if (!fonts || typeof fonts !== 'object') continue;

    if (Array.isArray(fonts.recommended)) {
      for (const font of fonts.recommended) {
        const family = normalizeCssFamily(font?.family ?? '');
        if (!family) continue;
        if (font.source === 'google') {
          recommendedGoogleFamilies.add(family);
        }
      }
    }

    if (Array.isArray(fonts.bundled)) {
      for (const font of fonts.bundled) {
        const family = normalizeCssFamily(font?.family ?? '');
        if (family) bundledFamilies.add(family);
      }
    }

    if (fonts.roles && typeof fonts.roles === 'object') {
      for (const chain of Object.values(fonts.roles)) {
        if (!Array.isArray(chain)) continue;
        for (const rawFamily of chain) {
          const family = normalizeCssFamily(rawFamily);
          if (!family || GENERIC_FONT_FAMILIES.has(family)) continue;
          roleFamilies.add(family);
        }
      }
    }
  }

  return {
    issues,
    roleFamilies,
    recommendedGoogleFamilies,
    bundledFamilies,
  };
}

async function checkFontRegistryConsistency() {
  const issues = [];
  const cssFontFaceFamilies = await parseOverlayCssFontFaces();
  const cssGoogleImportFamilies = await parseOverlayCssGoogleImports();
  const googleFamilies = await parseFontLoaderGoogleFamilies();
  const mirror = await loadCatalogMirror();
  const themeFonts = await collectThemeFontFamilies();
  issues.push(...themeFonts.issues);

  if (googleFamilies === null) {
    issues.push(
      'Could not parse LOCAL_GOOGLE_FONT_FAMILIES map from font-loader.ts — ' +
        'check declaration form or update the parser regex.',
    );
    return { cssFontFaceFamilies, googleFamilies: null, issues };
  }

  // 사용자가 picker에서 선택했을 때 실제로 로드 가능한 모든 family.
  const loadableFamilies = new Set([
    ...cssFontFaceFamilies, // overlay.css 직접 @font-face (alias 포함)
    ...cssGoogleImportFamilies, // Google Fonts CSS2 @import URL의 family
    ...googleFamilies, // LOCAL_GOOGLE_FONT_FAMILIES map (self-hosted lazy load)
    ...KNOWN_EXTERNAL_IMPORT_FAMILIES, // 외부 CSS @import이 가져오는 family
  ]);

  const roleLoadableFamilies = new Set([
    ...loadableFamilies,
    ...themeFonts.recommendedGoogleFamilies,
    ...themeFonts.bundledFamilies,
    ...SYSTEM_ROLE_FAMILIES,
  ]);

  // 검증 1: catalog의 모든 family(bundled ∪ google)가 어떤 경로로든 로드
  // 가능해야 한다. 누락되면 사용자가 picker에서 선택해도 silent fail
  // (2026-04-27 사고 클래스 결함).
  const allCatalogFamilies = [
    ...new Set([...mirror.bundled, ...mirror.google]),
  ];
  const unloadable = allCatalogFamilies.filter(
    (fam) => !loadableFamilies.has(fam),
  );
  if (unloadable.length > 0) {
    issues.push(
      `catalog 폰트인데 overlay에서 로드할 경로가 전혀 없음: ` +
        `[${unloadable.join(', ')}]. overlay.css @font-face / @import 또는 ` +
        'LOCAL_GOOGLE_FONT_FAMILIES에 추가 필요.',
    );
  }

  const unloadableRoleFamilies = [...themeFonts.roleFamilies].filter(
    (fam) => !roleLoadableFamilies.has(fam),
  );
  if (unloadableRoleFamilies.length > 0) {
    issues.push(
      `theme fonts.roles에서 참조하지만 로드 경로가 없는 family: ` +
        `[${unloadableRoleFamilies.join(', ')}]. recommended/bundled, ` +
        'overlay.css @font-face/@import, LOCAL_GOOGLE_FONT_FAMILIES 중 하나에 추가 필요.',
    );
  }

  const recommendedWithoutDynamicPath = [
    ...themeFonts.recommendedGoogleFamilies,
  ].filter(
    (fam) => !googleFamilies.has(fam) && !cssGoogleImportFamilies.has(fam),
  );
  if (recommendedWithoutDynamicPath.length > 0) {
    issues.push(
      `theme recommended google font인데 사용자 선택 시 동적 로드 경로가 없음: ` +
        `[${recommendedWithoutDynamicPath.join(', ')}]. ` +
        'LOCAL_GOOGLE_FONT_FAMILIES 또는 Google Fonts @import에 추가 필요.',
    );
  }

  // 검증 2: LOCAL_GOOGLE_FONT_FAMILIES map의 모든 family가 catalog mirror에 있어야.
  // mirror에 없는 family는 catalog가 노출하지 않는 폰트라 set에 둘 이유가
  // 없음 (dead entry).
  const catalogSet = new Set([
    ...allCatalogFamilies,
    ...themeFonts.recommendedGoogleFamilies,
  ]);
  const deadGoogle = [];
  for (const fam of googleFamilies) {
    if (!catalogSet.has(fam)) deadGoogle.push(fam);
  }
  if (deadGoogle.length > 0) {
    issues.push(
      `LOCAL_GOOGLE_FONT_FAMILIES에 있는데 catalog mirror에 없음 (dead entry): ` +
        `[${deadGoogle.join(', ')}]. 제거 권장.`,
    );
  }

  // 검증 3: overlay.css @font-face 정의 family 중 catalog에 없는 것은 dead
  // 정의 가능성. 단, alias 자체는 정상 (예: 'Pretendard' alias는 catalog에
  // bundled로 등록됨). 외부 import에서 정의되는 family는 제외.
  const deadFontFace = [];
  for (const fam of cssFontFaceFamilies) {
    if (catalogSet.has(fam)) continue;
    if (KNOWN_EXTERNAL_IMPORT_FAMILIES.has(fam)) continue;
    // 외부 CSS @import으로 들여온 family (NanumSquareNeo 등) — 우리가 직접
    // @font-face 작성하지 않은 외부 정의는 일단 허용. 이는 별도 외부 CSS
    // 의 정의이지 사용자 picker에는 노출되지 않는다.
    deadFontFace.push(fam);
  }
  if (deadFontFace.length > 0) {
    // dead 정의는 fail 대신 경고 (functional 영향 없음, cleanup 후보).
    console.warn(
      `[font-registry] overlay.css @font-face 정의 중 catalog에 없는 dead 후보: ` +
        `[${deadFontFace.join(', ')}]. 사용 안 되면 정리 권장.`,
    );
  }

  return { cssFontFaceFamilies, googleFamilies, issues };
}

async function checkLegacyCssCompatibility() {
  const issues = [];
  const legacyCssPath = join(
    PROJECT_ROOT,
    'public',
    'legacy',
    'overlay-tailwind-compat.css',
  );
  const content = await readFile(legacyCssPath, 'utf-8');
  const contentWithoutComments = content.replace(/\/\*[\s\S]*?\*\//g, '');
  const forbiddenAtRules = ['@layer', '@property', '@import'];
  for (const atRule of forbiddenAtRules) {
    const pattern = new RegExp(`${atRule}\\b`);
    if (pattern.test(contentWithoutComments)) {
      issues.push(`legacy CSS must not contain ${atRule}`);
    }
  }

  const requiredSnippets = [
    '.flex{display:flex}',
    '.bg-neutral-950',
    '.backdrop-blur-sm',
    '.-translate-y-1\\/2 { transform: translateY(-50%); }',
    '.scale-150 { transform: scale(1.5); }',
  ];
  for (const snippet of requiredSnippets) {
    if (!content.includes(snippet)) {
      issues.push(`legacy CSS missing required snippet: ${snippet}`);
    }
  }

  return { issues };
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main() {
  const results = [];
  for (const themeId of THEME_IDS) {
    try {
      const [meta, config] = await Promise.all([
        loadThemeIndexMeta(themeId),
        loadThemeConfig(themeId),
      ]);
      const issues = validateTheme(themeId, meta, config);
      results.push({ themeId, issues });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        themeId,
        issues: [`Failed to load theme: ${message}`],
      });
    }
  }

  let passed = 0;
  let failed = 0;
  for (const { themeId, issues } of results) {
    if (issues.length === 0) {
      console.log(`PASS  ${themeId}`);
      passed += 1;
    } else {
      console.log(`FAIL  ${themeId}`);
      for (const issue of issues) {
        console.log(`        - ${issue}`);
      }
      failed += 1;
    }
  }

  console.log('');
  console.log(`${passed}/${THEME_IDS.length} themes passed.`);

  // Font registry consistency check
  const fontResult = await checkFontRegistryConsistency();
  if (fontResult.issues.length === 0) {
    console.log(
      `PASS  font-registry  (${fontResult.cssFontFaceFamilies.size} @font-face / ` +
        `${fontResult.googleFamilies?.size ?? '?'} google entries, mirror 정합)`,
    );
  } else {
    console.log('FAIL  font-registry');
    for (const issue of fontResult.issues) {
      console.log(`        - ${issue}`);
    }
    failed += 1;
  }

  // Legacy CSS fallback check for OBS 29/30 and old XSplit Chromium 70/80.
  const legacyCssResult = await checkLegacyCssCompatibility();
  if (legacyCssResult.issues.length === 0) {
    console.log('PASS  legacy-css  (no @layer/@property/@import, transform fallbacks present)');
  } else {
    console.log('FAIL  legacy-css');
    for (const issue of legacyCssResult.issues) {
      console.log(`        - ${issue}`);
    }
    failed += 1;
  }

  if (failed > 0) {
    console.log(`${failed} check(s) failed.`);
    process.exit(1);
  }
  process.exit(0);
}

// Only run main() when this file is invoked as a script, not when imported.
if (process.argv[1] && resolve(process.argv[1]) === THIS_FILE) {
  main().catch((error) => {
    console.error('check-themes crashed:', error);
    process.exit(2);
  });
}
