import type { WidgetType } from "@/meloming/domains/channel/apis/overlay-theme";

/** 오버레이 통합 페이지 탭 ID. URL `?tab=` 쿼리 파라미터 값과 동일. */
export type OverlayTabId =
  | "overview"
  | "default"
  | "now-playing"
  | "queue"
  | "setlist"
  | "songbook-qr"
  | "total";

export const OVERLAY_TAB_IDS: readonly OverlayTabId[] = [
  "overview",
  "default",
  "total",
  "now-playing",
  "queue",
  "setlist",
  "songbook-qr",
] as const;

/** 탭바 표시용 라벨. tabs.ts에서 단일 출처로 관리. */
export const OVERLAY_TAB_LABELS: Record<OverlayTabId, string> = {
  overview: "개요",
  default: "테마설정",
  "now-playing": "재생중",
  queue: "대기열",
  setlist: "셋리스트",
  "songbook-qr": "노래책 QR",
  total: "통합 오버레이",
};

/**
 * `default` + 테마 적용 위젯. 이 탭들에선 ThemeConfigSection이 공용 draft state를 공유한다.
 * overview/total은 theme이 아니므로 dirty 여부에 따라 이동 시 확인.
 */
export const THEME_TAB_IDS = [
  "default",
  "now-playing",
  "queue",
  "setlist",
  "songbook-qr",
] as const satisfies readonly OverlayTabId[];

export type ThemeTabId = (typeof THEME_TAB_IDS)[number];

export function isThemeTab(tab: OverlayTabId): tab is ThemeTabId {
  return (THEME_TAB_IDS as readonly OverlayTabId[]).includes(tab);
}

/**
 * URL `?tab=` 값 → 유효한 OverlayTabId. 잘못된/누락된 값은 `overview`로 폴백.
 */
export function parseTabParam(raw: string | null | undefined): OverlayTabId {
  if (raw && (OVERLAY_TAB_IDS as readonly string[]).includes(raw)) {
    return raw as OverlayTabId;
  }
  return "overview";
}

/**
 * 탭의 해당 위젯 타입. overview/default는 null (위젯 URL 없음).
 */
export function tabToWidgetType(
  tab: OverlayTabId,
): WidgetType | "total" | null {
  if (tab === "overview" || tab === "default") return null;
  return tab;
}

/**
 * Tabs that come BEFORE the divider in the TabBar. Anything not in this
 * set sits AFTER the divider (per-widget tabs).
 */
export const PRIMARY_TAB_IDS: readonly OverlayTabId[] = [
  "overview",
  "default",
  "total",
] as const;

export function isPrimaryTab(tab: OverlayTabId): boolean {
  return (PRIMARY_TAB_IDS as readonly OverlayTabId[]).includes(tab);
}
