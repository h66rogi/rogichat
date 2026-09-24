import type { ThemeFonts } from '../types';

const loadedFonts = new Map<string, HTMLLinkElement>();
const pendingLoads = new Map<string, Promise<boolean>>();
// fontKey 단위 글로벌 ref count. loadGoogleFont 호출(또는 loadThemeFonts 내부
// 호출) 1회마다 +1, release 1회마다 -1. 0이 되어야 link.remove() 진행.
const fontRefCounts = new Map<string, number>();

const DEFAULT_MAX_FONT_FAMILIES = 4;
const MAX_WEIGHTS_PER_FAMILY = 3;
const FONT_READY_TIMEOUT_MS = 2500;

/**
 * Default multilingual fallback chain that gets appended to all themes.
 * Includes Korean support and emoji fonts.
 */
const DEFAULT_MULTILANG_FALLBACKS = [
  'NanumSquare Neo',
  'Pretendard',
  'Noto Sans KR',
  'Apple Color Emoji',
  'Segoe UI Emoji',
  'Noto Color Emoji',
  'sans-serif',
] as const;

/**
 * Platform-dependent font alternatives.
 * If a recommended font is not available on the user's OS,
 * the fallback chain in the role definition will catch it.
 */
const PLATFORM_FONT_FALLBACKS: Record<string, string[]> = {
  'SF Pro': ['Inter', 'system-ui'],
  'SF Pro Display': ['Inter', 'system-ui'],
  'Arial Black': ['Helvetica Bold', 'sans-serif'],
  Impact: ['Arial Black', 'Helvetica Bold', 'sans-serif'],
};

// Role chain에 섞여 있으면 브라우저가 거기서 match를 끊어 multilang
// fallback(NanumSquare Neo 등)에 도달하지 못함. buildFontFamilyValue 진입
// 시 제거하고, DEFAULT_MULTILANG_FALLBACKS 말미의 'sans-serif'가 최종
// generic을 담당하도록 위임한다.
const GENERIC_CSS_FAMILIES = new Set([
  'sans-serif',
  'serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
]);

/**
 * Families mirrored from Google Fonts into public/fonts/google.
 *
 * meloming-back theme-manifest catalog exposes these as `source: 'google'`,
 * but OBS Browser Source must not depend on live Google Fonts requests. The
 * loader keeps the old function names for compatibility while loading
 * per-family local CSS files from `/fonts/google/<slug>/font.css`.
 *
 * `Pretendard` stays excluded because it is bundled separately in overlay.css.
 */
const LOCAL_GOOGLE_FONT_FAMILIES = new Map<string, string>([
  ['Barlow', 'barlow'],
  ['Black Han Sans', 'black-han-sans'],
  ['Caveat', 'caveat'],
  ['Comfortaa', 'comfortaa'],
  ['DM Sans', 'dm-sans'],
  ['Fredoka', 'fredoka'],
  ['IBM Plex Sans', 'ibm-plex-sans'],
  ['IBM Plex Sans JP', 'ibm-plex-sans-jp'],
  ['IBM Plex Sans KR', 'ibm-plex-sans-kr'],
  ['Inter', 'inter'],
  ['Lora', 'lora'],
  ['Nanum Myeongjo', 'nanum-myeongjo'],
  ['Nanum Pen Script', 'nanum-pen-script'],
  ['Noto Sans KR', 'noto-sans-kr'],
  ['Noto Serif KR', 'noto-serif-kr'],
  ['Orbitron', 'orbitron'],
  ['Outfit', 'outfit'],
  ['Oxanium', 'oxanium'],
  ['Patrick Hand', 'patrick-hand'],
  ['Playfair Display', 'playfair-display'],
  ['Poppins', 'poppins'],
  ['Press Start 2P', 'press-start-2p'],
  ['Rajdhani', 'rajdhani'],
  ['Roboto Condensed', 'roboto-condensed'],
  ['Silkscreen', 'silkscreen'],
  ['VT323', 'vt323'],
]);

/**
 * 사용자가 picker에서 선택한 family가 self-hosted Google mirror 대상인지 판단.
 * bundled 폰트는 false 반환 → useCommonOptions가 loadGoogleFont 호출을 skip한다.
 */
export function isGoogleFontFamily(family: string): boolean {
  return LOCAL_GOOGLE_FONT_FAMILIES.has(normalizeFontFamily(family));
}

/**
 * Generate a stable key for the per-family local CSS file.
 */
function fontKey(family: string, _weights: number[]): string {
  return family;
}

function normalizeFontFamily(family: string): string {
  return family.trim().replace(/^(['"])(.*)\1$/, '$2');
}

/**
 * Limit weights per family to MAX_WEIGHTS_PER_FAMILY.
 * Picks the most common weights (400, 700) plus any extras.
 */
function limitWeights(weights: number[]): number[] {
  if (weights.length <= MAX_WEIGHTS_PER_FAMILY) return weights;
  // Prioritize 400, 700, then keep first remaining
  const prioritized = new Set<number>();
  if (weights.includes(400)) prioritized.add(400);
  if (weights.includes(700)) prioritized.add(700);
  for (const w of weights) {
    if (prioritized.size >= MAX_WEIGHTS_PER_FAMILY) break;
    prioritized.add(w);
  }
  return Array.from(prioritized).slice(0, MAX_WEIGHTS_PER_FAMILY);
}

function quoteFontFamilyForCss(family: string): string {
  return `'${family.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

async function waitForFontFaces(
  family: string,
  weights: number[],
  timeoutMs = FONT_READY_TIMEOUT_MS,
): Promise<void> {
  if (
    typeof document === 'undefined' ||
    typeof document.fonts?.load !== 'function'
  ) {
    return;
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const fontReady = Promise.all(
    weights.map((weight) =>
      document.fonts.load(`${weight} 16px ${quoteFontFamilyForCss(family)}`),
    ),
  ).then(() => undefined);
  const timeout = new Promise<void>((resolve) => {
    timeoutId = setTimeout(resolve, timeoutMs);
  });

  await Promise.race([fontReady, timeout]);
  if (timeoutId !== undefined) {
    clearTimeout(timeoutId);
  }
}

/**
 * Load a single self-hosted Google catalog font family via <link> injection.
 * Returns true on success, false on failure.
 *
 * **Acquire/release contract**: 매 호출이 fontRefCounts +1을 acquire한다.
 * 호출자는 끝났을 때 같은 (family, weights) 조합으로 `releaseGoogleFont()`를
 * 호출하여 ref를 -1해야 한다. 성공적으로 로드된 link는 세션 동안 유지해
 * 테마 전환/위젯 mount churn에서 폰트가 사라지거나 다시 깜빡이지 않게 한다.
 *
 * Idempotent: 같은 family+weights를 여러 번 호출해도 link는 한 번만 주입.
 */
export async function loadGoogleFont(
  family: string,
  weights: number[] = [400, 700]
): Promise<boolean> {
  if (typeof document === 'undefined') return false;

  const normalizedFamily = normalizeFontFamily(family);
  const limitedWeights = limitWeights(weights);
  const key = fontKey(normalizedFamily, limitedWeights);

  // 이미 로드된 경우 — ref만 +1 후 즉시 성공.
  if (loadedFonts.has(key)) {
    fontRefCounts.set(key, (fontRefCounts.get(key) ?? 0) + 1);
    return true;
  }

  // In-flight dedupe: 다른 호출자가 같은 family+weight 로딩 중이면 ref만 +1
  // 후 같은 promise를 반환. 한 link만 DOM에 추가됨.
  const pending = pendingLoads.get(key);
  if (pending) {
    fontRefCounts.set(key, (fontRefCounts.get(key) ?? 0) + 1);
    return pending;
  }

  // 새 로딩 시작 — ref count 1로 시작.
  fontRefCounts.set(key, 1);

  const loadPromise = (async () => {
    const slug = LOCAL_GOOGLE_FONT_FAMILIES.get(normalizedFamily);
    if (!slug) return false;

    const url = `/fonts/google/${slug}/font.css`;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.setAttribute('data-font-key', key);

    try {
      await new Promise<void>((resolve, reject) => {
        link.onload = () => resolve();
        link.onerror = () => reject(new Error(`Failed to load local font CSS: ${normalizedFamily}`));
        document.head.appendChild(link);
      });

      await waitForFontFaces(normalizedFamily, limitedWeights);

      // onload 도달 시점에 이미 모든 컨슈머가 release했으면(ref ≤ 0) 아무도 link
      // 를 원하지 않는 상태다. loadedFonts에 등록하지 않고 즉시 제거해야
      // orphan link(ref=0인데 DOM에 붙어있는)가 생기지 않는다.
      if ((fontRefCounts.get(key) ?? 0) <= 0) {
        link.remove();
        return false;
      }
      loadedFonts.set(key, link);
      return true;
    } catch (error) {
      console.warn(`[font-loader] Failed to load local font CSS: ${normalizedFamily}`, error);
      // 로드 실패 → 자기 ref 되돌리기 (없는 link 참조 방지). 추가 호출자들의
      // ref는 pending 구간에서 증가한 만큼 본인 release에서 차감됨.
      decrementFontRefByKey(key);
      // 실패한 link도 DOM에서 제거 (네트워크 에러 등).
      if (link.parentNode) link.parentNode.removeChild(link);
      return false;
    } finally {
      pendingLoads.delete(key);
    }
  })();

  pendingLoads.set(key, loadPromise);
  return loadPromise;
}

/**
 * loadGoogleFont로 acquire한 font를 release. ref가 0이 되어도 성공적으로
 * 로드된 stylesheet는 유지한다. 구형 CEF에서 theme/widget 전환 시 폰트 link
 * remove → 재삽입 사이에 fallback font가 고착되는 사례를 피하기 위함이다.
 * 호출자(useEffect cleanup, theme handle release)가 acquire 1회당 1회 호출해야
 * 함. 잘못된 호출(없는 키, 음수 가능)은 silent no-op.
 */
export function releaseGoogleFont(
  family: string,
  weights: number[] = [400, 700]
): void {
  const normalizedFamily = normalizeFontFamily(family);
  const limitedWeights = limitWeights(weights);
  const key = fontKey(normalizedFamily, limitedWeights);
  decrementFontRefByKey(key);
}

function decrementFontRefByKey(key: string): void {
  const next = (fontRefCounts.get(key) ?? 0) - 1;
  if (next <= 0) {
    fontRefCounts.delete(key);
  } else {
    fontRefCounts.set(key, next);
  }
}

/**
 * 한 번의 loadThemeFonts 호출에 대한 release handle. 호출자가 effect cleanup
 * 등에서 release()를 호출해야 acquire한 font가 ref 차감됨.
 *
 * 호출 단위 ownership: 호출마다 자기가 acquire한 key 목록을 들고 있어, /total
 * 페이지에서 같은 테마를 두 위젯이 각각 load해도 각 인스턴스가 자기 release
 * 만 호출하면 정확히 ref가 일치한다. release는 load가 아직 진행 중이어도
 * 즉시 호출 가능 — 내부 loop이 released 플래그를 보고 짧게 수렴한다.
 */
export interface ThemeFontHandle {
  /** 현재까지 성공적으로 acquire한 font 개수 (load 진행 중엔 증가 가능). */
  readonly successCount: number;
  /** 이미 release됐는지 여부. */
  readonly released: boolean;
  /** 이 호출이 acquire한 font들을 release. 멱등(중복 호출 안전). */
  release: () => void;
}

/**
 * Load all fonts for a theme. Returns `{ handle, ready }`:
 * - `handle`: 즉시 반환. caller가 effect cleanup에서 handle.release() 호출.
 * - `ready`: 모든 font load가 끝나거나 release로 중단된 시점에 resolve.
 *
 * 이 구조가 중요한 이유: loadThemeFonts 내부 loop 도중(일부 font는 이미 acquire)
 * 에 caller의 effect가 cancel되면, 즉시 handle.release()가 가능해야 한다.
 * 이전 Promise<Handle> 구조는 handle을 반환하기 전(loop 중) release할 방법이
 * 없어 acquired font가 released 될 때까지 잠김.
 */
export interface LoadThemeFontsResult {
  handle: ThemeFontHandle;
  ready: Promise<number>;
}

export function loadThemeFonts(
  themeId: string,
  fonts: ThemeFonts,
  maxFamilies: number = DEFAULT_MAX_FONT_FAMILIES,
): LoadThemeFontsResult {
  const selfHostedGoogleFonts = fonts.recommended.filter((f) => f.source === 'google');
  const budgeted = selfHostedGoogleFonts.slice(0, maxFamilies);
  if (selfHostedGoogleFonts.length > maxFamilies) {
    console.warn(
      `[font-loader] Theme ${themeId} requested ${selfHostedGoogleFonts.length} self-hosted Google fonts, ` +
        `loading only first ${maxFamilies} (budget exceeded)`,
    );
  }

  const acquiredKeys: string[] = [];
  let released = false;

  const handle: ThemeFontHandle = {
    get successCount() {
      return acquiredKeys.length;
    },
    get released() {
      return released;
    },
    release: () => {
      if (released) return;
      released = true;
      for (const key of acquiredKeys) {
        decrementFontRefByKey(key);
      }
      acquiredKeys.length = 0;
    },
  };

  const ready = (async () => {
    for (const font of budgeted) {
      if (released) break;
      const limited = limitWeights(font.weights);
      const key = fontKey(font.family, limited);
      const success = await loadGoogleFont(font.family, limited);
      if (released) {
        // load 중 release됨 — 방금 acquire한 ref는 handle이 아닌 이 loop이
        // 즉시 반환.
        if (success) decrementFontRefByKey(key);
        break;
      }
      if (success) acquiredKeys.push(key);
    }
    return acquiredKeys.length;
  })();

  return { handle, ready };
}

/**
 * Build a CSS font-family value with the role's chain plus default fallbacks.
 * Also injects platform fallbacks for known platform-specific fonts.
 *
 * Example: ['Press Start 2P', 'monospace']
 *  → 'Press Start 2P', 'monospace', 'Pretendard', 'Noto Sans KR', ..., 'sans-serif'
 *
 * If the chain contains 'SF Pro', adds 'Inter' as a fallback before the next item.
 */
export function buildFontFamilyValue(roleChain: string[]): string {
  const expanded: string[] = [];
  for (const rawFamily of roleChain) {
    const family = normalizeFontFamily(rawFamily);
    if (!family) continue;
    if (GENERIC_CSS_FAMILIES.has(family)) continue;
    expanded.push(family);
    const platformFallbacks = PLATFORM_FONT_FALLBACKS[family];
    if (platformFallbacks) {
      expanded.push(...platformFallbacks.filter(f => !GENERIC_CSS_FAMILIES.has(f)));
    }
  }

  // Append multilingual fallbacks if not already present (preserve order)
  const result = [...expanded];
  for (const fallback of DEFAULT_MULTILANG_FALLBACKS) {
    if (!result.includes(fallback)) {
      result.push(fallback);
    }
  }

  // Quote families containing spaces
  return result.map((f) => (f.includes(' ') ? `'${f}'` : f)).join(', ');
}

/**
 * Get the count of currently loaded Google fonts (for debugging/budgets).
 */
export function getLoadedFontCount(): number {
  return loadedFonts.size;
}

/**
 * Clear ALL loaded fonts. For testing/cleanup.
 */
export function clearAllFonts(): void {
  for (const link of loadedFonts.values()) {
    link.remove();
  }
  loadedFonts.clear();
  fontRefCounts.clear();
  pendingLoads.clear();
}
