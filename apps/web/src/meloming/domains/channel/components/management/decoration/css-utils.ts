/**
 * 채널 커스텀 CSS 유틸리티 함수
 */

const CHANNEL_CSS_ID = "channel-custom-css";
const CHANNEL_PREVIEW_CSS_ID = "channel-preview-css";

/**
 * 채널 커스텀 CSS 적용
 * 실제 채널 페이지에 CSS를 적용합니다.
 */
export function applyChannelCss(css: string): void {
  removeChannelCss();

  const styleElement = document.createElement("style");
  styleElement.id = CHANNEL_CSS_ID;
  styleElement.textContent = css;
  document.head.appendChild(styleElement);
}

/**
 * 채널 커스텀 CSS 제거
 */
export function removeChannelCss(): void {
  const existingStyle = document.getElementById(CHANNEL_CSS_ID);
  if (existingStyle) {
    existingStyle.remove();
  }
}

/**
 * 미리보기용 CSS 적용
 * 편집 중 실시간 미리보기를 위한 임시 CSS입니다.
 */
export function applyPreviewCss(css: string): void {
  let previewStyle = document.getElementById(CHANNEL_PREVIEW_CSS_ID);
  if (!previewStyle) {
    previewStyle = document.createElement("style");
    previewStyle.id = CHANNEL_PREVIEW_CSS_ID;
    document.head.appendChild(previewStyle);
  }
  previewStyle.textContent = css;
}

/**
 * 미리보기용 CSS 제거
 */
export function removePreviewCss(): void {
  const previewStyle = document.getElementById(CHANNEL_PREVIEW_CSS_ID);
  if (previewStyle) {
    previewStyle.remove();
  }
}

/**
 * CSS 크기 계산 (바이트 단위)
 */
export function getCssSize(css: string): number {
  return new Blob([css]).size;
}

/**
 * CSS 크기를 사람이 읽기 쉬운 형태로 변환
 */
export function formatCssSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  return `${kb.toFixed(1)} KB`;
}

/**
 * CSS 최대 크기 (100KB)
 */
export const MAX_CSS_SIZE_BYTES = 100 * 1024;

/**
 * CSS 크기가 제한을 초과하는지 확인
 */
export function isCssSizeExceeded(css: string): boolean {
  return getCssSize(css) > MAX_CSS_SIZE_BYTES;
}

