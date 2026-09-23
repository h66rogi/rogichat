/**
 * 오버레이 위젯 커스텀 CSS 관련 타입 정의
 */

export type OverlayWidgetType =
  | "queue"
  | "now-playing"
  | "setlist"
  | "songbook-qr";

export const OVERLAY_WIDGET_TYPES: OverlayWidgetType[] = [
  "queue",
  "now-playing",
  "setlist",
  "songbook-qr",
];

export const OVERLAY_WIDGET_LABELS: Record<OverlayWidgetType, string> = {
  queue: "신청곡",
  "now-playing": "지금 부르는 곡",
  setlist: "곡 목록",
  "songbook-qr": "노래책 QR",
};

/**
 * 오버레이 위젯 커스터마이징 데이터
 */
export interface OverlayWidgetCustomizationData {
  id: number;
  channelId: number;
  widgetType: OverlayWidgetType;
  customCss: string | null;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * 오버레이 위젯 CSS 목록 조회 응답
 * GET /channel/:identifier/overlay-customization/css
 */
export interface OverlayWidgetCssListResponse {
  items: OverlayWidgetCustomizationData[];
  isOwner: boolean;
  isOwnerPro: boolean;
  canSave: boolean;
}

/**
 * 오버레이 위젯 CSS 저장/수정 요청 바디
 * PUT /channel/:identifier/overlay-customization/css/:widget
 */
export interface PutOverlayWidgetCssRequestBody {
  customCss?: string;
  isEnabled?: boolean;
}
