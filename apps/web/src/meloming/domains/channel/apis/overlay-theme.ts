import { apiClient } from "@/meloming/shared/lib/api-client";

// Types

/**
 * 통합 오버레이에서 위젯별 테마 오버라이드를 적용할 수 있는 위젯 타입.
 * 백엔드 `WidgetType` (theme-manifest/widget-types)와 동기화 유지.
 */
export type WidgetType =
  | "now-playing"
  | "queue"
  | "setlist"
  | "songbook-qr";

/**
 * Runtime list of all valid `WidgetType` values. Used to sanitize override
 * payloads (server-side history may contain stale keys, e.g. `"songlist"`,
 * that the backend will reject with 400). Keep in sync with the union above.
 */
export const VALID_WIDGET_TYPES: readonly WidgetType[] = [
  "now-playing",
  "queue",
  "setlist",
  "songbook-qr",
] as const;

/**
 * Type guard for `WidgetType`. Used by override sanitizers on read and save.
 */
export function isValidWidgetType(value: string): value is WidgetType {
  return (VALID_WIDGET_TYPES as readonly string[]).includes(value);
}

/**
 * Phase 3 통합 테마 응답 — 채널 기본 + 위젯별 override.
 *
 * - `default.themeId`: 채널 기본 테마 (catalog ID 중 하나)
 * - `default.options`: 채널 기본 옵션 커스텀
 * - `widgets[wt].themeId`: null이면 채널 기본 상속, 값이 있으면 override
 * - `widgets[wt].options`: null이면 채널 기본 상속, 값이 있으면 override
 */
export interface WidgetThemeEntry {
  themeId: string | null;
  options: Record<string, unknown> | null;
}

export interface UnifiedThemeConfig {
  default: { themeId: string; options: Record<string, unknown> };
  widgets: Record<string, WidgetThemeEntry>;
}

/**
 * PUT 배치 요청 body — 응답 구조와 다름에 주의.
 * `default`/`widgets` 구조가 아닌 flat 구조로 전송.
 */
export interface UpdateThemeConfigBody {
  themeId: string;
  options?: Record<string, unknown>;
  widgets?: Record<string, { themeId?: string | null; options?: Record<string, unknown> | null }>;
}

/**
 * UnifiedThemeConfig (UI state) → UpdateThemeConfigBody (PUT body) 변환.
 *
 * widgets는 VALID_WIDGET_TYPES 기준으로 필터링한다. 서버 히스토리에 stale
 * widget key(예: legacy "songlist")가 섞여 들어오면 backend가 400으로 reject
 * 해 사용자가 정상 옵션만 수정해도 저장이 실패하고 save bar가 stuck되는
 * regression이 있어, 저장 직전에 확실히 sanitize.
 */
export function toUpdateBody(config: UnifiedThemeConfig): UpdateThemeConfigBody {
  const sanitizedWidgets: Record<string, WidgetThemeEntry> = {};
  for (const [key, value] of Object.entries(config.widgets ?? {})) {
    if (isValidWidgetType(key)) {
      sanitizedWidgets[key] = value;
    }
  }
  return {
    themeId: config.default.themeId,
    options: config.default.options,
    widgets: sanitizedWidgets,
  };
}

// Theme catalog types — mirror backend Phase 1.1 (theme-manifest/types.ts)

export interface ThemeFontSpec {
  family: string;
  source: string;
  weights: number[];
  url?: string;
  scripts?: string[];
  /** UI 표시용 이름. 한글 폰트는 정식 한글명, 영문 전용은 영문. 누락 시 family로 fallback. */
  displayName?: string;
}

export interface ThemeFontDefinitions {
  roles: Record<string, string[]>;
  recommended: ThemeFontSpec[];
  bundled: ThemeFontSpec[];
}

export interface ThemeOptionChoice {
  value: string | number | boolean;
  label: string;
}

export interface ThemeOptionSchemaEntry {
  key: string;
  type: "color" | "range" | "select" | "toggle" | "font" | "number" | "text";
  label: string;
  default: unknown;
  group?: string;
  helpText?: string;
  required?: boolean;
  dependsOn?: { key: string; value: unknown };
  min?: number;
  max?: number;
  step?: number;
  /**
   * Optional display unit suffix for numeric fields (e.g. `'×'`, `'px'`, `'%'`).
   * Currently rendered by `RangeField` beside the current value.
   */
  unit?: string;
  choices?: ThemeOptionChoice[];
  maxLength?: number;
}

export interface ThemePreset {
  id: string;
  name: string;
  description?: string;
  thumbnail?: string;
  options: Record<string, unknown>;
  isDefault?: boolean;
}

export interface ThemeAnimationSpec {
  name: string;
  enterDuration: number;
  exitDuration?: number;
  easing?: string;
  delay?: number;
  stagger?: number;
  iterations?: number;
  css?: string;
}

export interface ThemePerformanceHints {
  usesBackdropFilter?: boolean;
  uses3DTransform?: boolean;
  usesHeavyAnimation?: boolean;
  maxFontFamilies?: number;
}

export interface ThemeSubtheme {
  id: string;
  name: string;
  description: string;
  fonts: ThemeFontDefinitions;
  defaultOptions: Record<string, unknown>;
  presets: ThemePreset[];
  animations: Record<string, ThemeAnimationSpec>;
  cssVariables?: Record<string, string>;
}

export interface ThemeCatalogEntry {
  id: string;
  name: string;
  tags: string[];
  description: string;
  thumbnail: string;
  fonts: ThemeFontDefinitions;
  optionSchema: ThemeOptionSchemaEntry[];
  defaultOptions: Record<string, unknown>;
  presets: ThemePreset[];
  animations: Record<string, ThemeAnimationSpec>;
  cssVariables?: Record<string, string>;
  performance?: ThemePerformanceHints;
  subthemes?: ThemeSubtheme[];
}

export interface ThemeCatalogListResponse {
  themes: ThemeCatalogEntry[];
}

export interface ThemeCatalogDetailResponse {
  theme: ThemeCatalogEntry;
}

// API Functions

/**
 * 채널의 통합 오버레이 테마 조회 (Phase 3 unified).
 *
 * 저장된 값이 없으면 백엔드가 lazy-create하여 기본값(default.themeId=brutalist) 반환.
 */
export async function getUnifiedThemeConfig(
  identifier: string
): Promise<UnifiedThemeConfig> {
  const response = await apiClient.get<UnifiedThemeConfig>(
    `/channel/${identifier}/overlay-theme`,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * 채널의 통합 오버레이 테마 배치 업데이트 (Phase 3 unified).
 *
 * PUT 의미: 채널 기본 + 위젯별 override를 한 번에 저장. Transaction atomic.
 * 저장 후 백엔드가 `overlay.theme-config.updated` WS 이벤트를 발행.
 */
export async function updateUnifiedThemeConfig(
  identifier: string,
  body: UpdateThemeConfigBody
): Promise<UnifiedThemeConfig> {
  const response = await apiClient.put<UnifiedThemeConfig>(
    `/channel/${identifier}/overlay-theme`,
    body,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * 카탈로그에 등록된 17개 테마 목록 조회 (인증 불필요)
 */
export async function getThemeCatalog(): Promise<ThemeCatalogListResponse> {
  const response = await apiClient.get<ThemeCatalogListResponse>(
    `/overlay-themes`
  );
  return response.data;
}

/**
 * 테마 카탈로그를 웹 프론트 표시 순서로 재배치한다.
 *
 * 백엔드 카탈로그(`THEME_IDS`) 순서는 `spotify → billboard → … → concert-poster`
 * (맨 끝)이지만, 웹에서는 추천 테마인 `concert-poster`를 `spotify`와 `billboard`
 * 사이로 끌어올려 노출한다. 백엔드 순서를 바꾸면 오버레이 앱·모바일 등 다른
 * 클라이언트까지 영향을 주므로, 표시 순서 조정은 웹 프론트에서만 수행한다.
 *
 * `spotify` 또는 `concert-poster`가 카탈로그에 없으면 원본 순서를 그대로 반환한다.
 */
export function orderThemeCatalogForDisplay(
  themes: ThemeCatalogEntry[]
): ThemeCatalogEntry[] {
  const concertIndex = themes.findIndex((t) => t.id === "concert-poster");
  const hasSpotify = themes.some((t) => t.id === "spotify");
  if (concertIndex === -1 || !hasSpotify) return themes;

  const reordered = [...themes];
  const [concert] = reordered.splice(concertIndex, 1);
  const spotifyIndex = reordered.findIndex((t) => t.id === "spotify");
  reordered.splice(spotifyIndex + 1, 0, concert);
  return reordered;
}

/**
 * 단일 테마 카탈로그 항목 조회 (인증 불필요)
 *
 * 카탈로그에 없는 themeId의 경우 404를 반환한다.
 */
export async function getThemeDetail(
  themeId: string
): Promise<ThemeCatalogDetailResponse> {
  const response = await apiClient.get<ThemeCatalogDetailResponse>(
    `/overlay-themes/${themeId}`
  );
  return response.data;
}
