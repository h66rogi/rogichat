/**
 * 채널 커스텀 CSS 관련 타입 정의
 * @see docs/channel-customization-api-documentation copy.md
 */

/**
 * 커스텀 CSS 데이터
 */
export const CHANNEL_COLOR_MODE_OPTIONS = ["system", "light", "dark"] as const;

export type ChannelCustomizationColorMode =
  (typeof CHANNEL_COLOR_MODE_OPTIONS)[number];

export const DEFAULT_CHANNEL_COLOR_MODE: ChannelCustomizationColorMode = "light";

export const CHANNEL_LAYOUT_WIDTH_OPTIONS = ["default", "wide"] as const;

export type ChannelLayoutWidth =
  (typeof CHANNEL_LAYOUT_WIDTH_OPTIONS)[number];

export const DEFAULT_CHANNEL_LAYOUT_WIDTH: ChannelLayoutWidth = "default";

export const CHANNEL_HEADER_STYLE_OPTIONS = ["wide", "separated"] as const;

export type ChannelHeaderStyle =
  (typeof CHANNEL_HEADER_STYLE_OPTIONS)[number];

export const DEFAULT_CHANNEL_HEADER_STYLE: ChannelHeaderStyle = "wide";

/**
 * 채널 페이지 레이아웃 타입
 * - legacy: 기존 레이아웃 (가로 탭 + 배너)
 * - new: 신규 레이아웃 (접힌 전역 사이드바 + 채널 메뉴 사이드바 + 콘텐츠)
 * 별도 설정이 없으면 new가 기본.
 */
export const CHANNEL_LAYOUT_TYPE_OPTIONS = ["legacy", "new"] as const;

export type ChannelLayoutType =
  (typeof CHANNEL_LAYOUT_TYPE_OPTIONS)[number];

export const DEFAULT_CHANNEL_LAYOUT_TYPE: ChannelLayoutType = "new";

export function normalizeChannelColorMode(
  mode?: string | null
): ChannelCustomizationColorMode {
  if (
    mode === "system" ||
    mode === "light" ||
    mode === "dark"
  ) {
    return mode;
  }
  return DEFAULT_CHANNEL_COLOR_MODE;
}

export interface ChannelCustomizationData {
  id: number;
  channelId: number;
  customCss: string | null;
  isEnabled: boolean;
  /** 신규 레이아웃 전용 커스텀 CSS (기존 레이아웃 CSS와 분리 보관) */
  customCssNew: string | null;
  /** 신규 레이아웃 커스텀 CSS 활성화 여부 */
  isEnabledNew: boolean;
  /** 현재 선택된 레이아웃 타입 (legacy/new) */
  layoutType: ChannelLayoutType;
  forcedColorMode?: ChannelCustomizationColorMode | null;
  layoutWidth: ChannelLayoutWidth;
  headerStyle: ChannelHeaderStyle;
  createdAt: string;
  updatedAt: string;
}

/**
 * 커스텀 CSS 조회 응답 (권한 정보 포함)
 * GET /channel/:identifier/customization/css
 */
export interface ChannelCustomizationResponse {
  customization: ChannelCustomizationData | null;
  isOwner: boolean;
  isOwnerPro: boolean;
  canSave: boolean;
}

/**
 * @deprecated Use ChannelCustomizationData instead
 */
export type ChannelCustomization = ChannelCustomizationData;

/**
 * CSS 저장/수정 요청 바디
 * PUT /channel/:identifier/customization/css
 */
export interface PutCustomizationCssRequestBody {
  customCss?: string;
  isEnabled?: boolean;
  customCssNew?: string;
  isEnabledNew?: boolean;
  layoutType?: ChannelLayoutType;
  forcedColorMode?: ChannelCustomizationColorMode;
  layoutWidth?: ChannelLayoutWidth;
  headerStyle?: ChannelHeaderStyle;
}

/**
 * CSS 활성화/비활성화 요청 바디
 * PATCH /channel/:identifier/customization/css/enable
 */
export interface PatchCustomizationEnableRequestBody {
  isEnabled: boolean;
}

/**
 * CSS 검증 에러 항목
 */
export interface CssValidationError {
  message: string;
  line?: number;
  column?: number;
}

/**
 * CSS 검증 실패 응답 (400 Bad Request)
 */
export interface CssValidationErrorResponse {
  message: string;
  errors: CssValidationError[];
}

/**
 * CSS 템플릿 정의
 */
export interface CssTemplate {
  id: string;
  name: string;
  description: string;
  preview?: string; // 썸네일 이미지 URL (선택)
  css: string;
}
