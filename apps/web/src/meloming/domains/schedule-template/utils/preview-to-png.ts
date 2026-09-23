/**
 * 클라이언트 미리보기 PNG 변환 래퍼.
 *
 * - `html-to-image.toBlob()` 기반. canvas → blob 직변환으로 dataURL 보다 메모리/
 *   GC 부담이 작다.
 * - 외부 도메인 이미지(`baseImageUrl`, `channel.profileImageUrl`)가 CORS 헤더를
 *   주지 않으면 toBlob 이 SecurityError 로 throw 한다. 이 경우 호출 측이 토스트
 *   안내 후 서버 렌더 경로로 안내한다 (PreviewError.code === 'CORS').
 * - cacheBust 활성화 — CDN 캐시된 응답이 CORS 헤더 없이 응답되는 경우 회피.
 */

import { toBlob } from "html-to-image";

export type PreviewErrorCode = "CORS" | "EMPTY" | "RENDER_FAILED";

export class PreviewError extends Error {
  readonly code: PreviewErrorCode;

  constructor(code: PreviewErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "PreviewError";
  }
}

interface PreviewToPngOptions {
  /** 출력 픽셀 비율. 기본 1 (디자인 좌표 기준). */
  pixelRatio?: number;
  /** PNG 배경색. PSD 가 투명 배경인 경우 일관된 결과를 위해 흰색 기본. */
  backgroundColor?: string;
  /**
   * SVG viewBox / 렌더 노드에 강제 적용할 폭 (px). html-to-image 의 `width`.
   * 디자인 좌표계 자연 폭 (예: baseImageW) 을 넣으면 모든 슬롯이 짤리지 않고
   * 다 그려진다. 미지정 시 node 의 clientWidth.
   */
  width?: number;
  /** SVG viewBox / 렌더 노드에 강제 적용할 높이 (px). html-to-image 의 `height`. */
  height?: number;
  /**
   * 캔버스 (=결과 PNG) 의 가로 픽셀. html-to-image 의 `canvasWidth`. 미지정 시
   * `width` 와 동일. baseImageW 보다 작은 값을 주면 SVG 가 자연 좌표로 렌더된
   * 후 캔버스에 다운샘플되어 그려진다 (원본 슬롯이 짤리지 않은 채 더 작은 PNG).
   */
  canvasWidth?: number;
  /** 캔버스의 세로 픽셀. html-to-image 의 `canvasHeight`. */
  canvasHeight?: number;
}

/**
 * `node` 를 PNG Blob 으로 변환한다.
 *
 * 실패 시 `PreviewError` throw — 코드별 분기:
 *   - CORS: cross-origin 이미지가 CORS 헤더 없이 그려져 tainted canvas
 *   - EMPTY: toBlob 이 null 반환 (드물지만 환경에 따라)
 *   - RENDER_FAILED: 그 외 모든 예외
 */
export async function previewToPng(
  node: HTMLElement,
  options?: PreviewToPngOptions,
): Promise<Blob> {
  let blob: Blob | null;
  try {
    blob = await toBlob(node, {
      pixelRatio: options?.pixelRatio ?? 1,
      cacheBust: true,
      backgroundColor: options?.backgroundColor ?? "#ffffff",
      width: options?.width,
      height: options?.height,
      canvasWidth: options?.canvasWidth,
      canvasHeight: options?.canvasHeight,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // tainted canvas 에러는 브라우저가 SecurityError 또는 DOMException 로 던진다.
    if (
      /tainted|CORS|cross-origin|SecurityError/i.test(message) ||
      (error instanceof DOMException && error.name === "SecurityError")
    ) {
      throw new PreviewError(
        "CORS",
        `미리보기 이미지에 외부 도메인이 포함되어 있어요. (${message})`,
      );
    }
    throw new PreviewError(
      "RENDER_FAILED",
      `미리보기 변환에 실패했어요. (${message})`,
    );
  }

  if (!blob) {
    throw new PreviewError("EMPTY", "미리보기 변환 결과가 비어 있어요.");
  }
  return blob;
}

/**
 * 결과 Blob 을 다운로드 트리거한다. 서버 렌더 다운로드와 동일한 UX.
 */
export function downloadBlobAsPng(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename.endsWith(".png") ? filename : `${filename}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    // ObjectURL 즉시 해제 — link.click() 다운로드 시점은 동기적으로 큐잉되므로
    // 다음 microtask 까진 url 이 살아있을 필요가 있다. 안전하게 다음 tick 에 해제.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
