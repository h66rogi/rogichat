/**
 * 캔버스 zoom + pan 순수 유틸 (Phase Figma-canvas).
 *
 * Editor Canvas 의 viewport 변환 (zoom 배율 + pan offset) 을 다루는 모든 수학을
 * 한곳에 모아서 React 컴포넌트는 이벤트 핸들링과 상태 업데이트만 담당하게 한다.
 *
 * 좌표계 정의:
 *   - **design space** (디자인/저장 좌표계): 베이스 이미지 원본 px. 슬롯 x/y/w/h 가
 *     사용하는 좌표계와 동일. zoom=1, pan=(0,0) 일 때 화면 1px = design 1px.
 *   - **screen space** (화면 좌표계): viewport DOM 의 client 좌표. 마우스 이벤트의
 *     clientX/clientY 가 사용. screen → design 변환은 zoom + pan 모두 보정 필요.
 *
 * 변환 규칙:
 *   designX = (screenX - viewportLeft - panX) / zoom
 *   designY = (screenY - viewportTop  - panY) / zoom
 *
 * Inverse:
 *   screenX = designX * zoom + panX + viewportLeft
 *
 * Cursor-anchored zoom:
 *   휠/단축키로 zoom 을 바꿀 때, 마우스 커서 아래의 design 좌표가 zoom 전후로
 *   변하지 않아야 한다 (Figma 와 동일). 그러려면 panX/panY 를 같이 보정해야 한다.
 *   → zoomTowardPoint() 가 새 zoom + 보정된 panX/panY 를 반환.
 */

/** 최소 zoom 배율 (10%). Figma 와 같은 수준으로 설정. */
export const MIN_ZOOM = 0.1;

/** 최대 zoom 배율 (1600%). Figma 와 동일. */
export const MAX_ZOOM = 16;

/** zoom 단계 비율 (휠/단축키 1회당). Figma 의 1.2 배율과 유사 (1단계 ≈ 20%). */
export const ZOOM_STEP_RATIO = 1.2;

/**
 * zoom 값을 [MIN_ZOOM, MAX_ZOOM] 범위로 clamp.
 * NaN/Infinity 는 1 로 fallback (안전망).
 */
export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  if (value < MIN_ZOOM) return MIN_ZOOM;
  if (value > MAX_ZOOM) return MAX_ZOOM;
  return value;
}

/**
 * 한 단계 줌-인 / 줌-아웃 시 사용할 다음 zoom 배율.
 * 단순 곱셈/나눗셈으로 단계 이동 (clamp 포함).
 */
export function zoomInStep(currentZoom: number): number {
  return clampZoom(currentZoom * ZOOM_STEP_RATIO);
}

export function zoomOutStep(currentZoom: number): number {
  return clampZoom(currentZoom / ZOOM_STEP_RATIO);
}

/**
 * 화면(viewport-local) 좌표를 design 좌표로 변환.
 *
 * `screenX/Y` 는 viewport 컨테이너의 좌상단 기준 좌표 (이미 viewportLeft/Top 을
 * 빼둔 값). 마우스 이벤트의 clientX/Y 를 그대로 넘기지 말고 viewport rect 의
 * (left, top) 을 빼서 normalize 한 뒤 호출할 것.
 *
 * `panX/Y` 는 inner content (canvas) 의 translate 양 — 양수면 inner content 가
 * 오른쪽/아래로 이동된 상태.
 */
export function screenToDesign(
  screenX: number,
  screenY: number,
  zoom: number,
  panX: number,
  panY: number,
): { x: number; y: number } {
  const safeZoom = zoom <= 0 ? 1 : zoom;
  return {
    x: (screenX - panX) / safeZoom,
    y: (screenY - panY) / safeZoom,
  };
}

/**
 * design 좌표를 screen(viewport-local) 좌표로 변환. screenToDesign 의 역연산.
 */
export function designToScreen(
  designX: number,
  designY: number,
  zoom: number,
  panX: number,
  panY: number,
): { x: number; y: number } {
  return {
    x: designX * zoom + panX,
    y: designY * zoom + panY,
  };
}

/**
 * Cursor-anchored zoom — 마우스 커서 아래의 design 픽셀이 zoom 전후로 정확히
 * 같은 화면 위치를 유지하도록 panX/panY 를 보정.
 *
 * 알고리즘:
 *   1. 현재 zoom + pan 으로 cursor 의 design 좌표 (cx, cy) 계산
 *   2. nextZoom 으로 cursor 가 같은 design 좌표 (cx, cy) 를 가리키게 만드는 pan 계산
 *      → panX' = screenX - cx * nextZoom
 *      → panY' = screenY - cy * nextZoom
 *
 * @param currentZoom 현재 zoom 배율
 * @param currentPanX 현재 panX
 * @param currentPanY 현재 panY
 * @param cursorX 마우스 커서의 viewport-local X (clientX - viewportLeft)
 * @param cursorY 마우스 커서의 viewport-local Y (clientY - viewportTop)
 * @param nextZoom 적용하려는 새 zoom (clamp 전이어도 OK — 함수 내부에서 clamp)
 */
export function zoomTowardPoint(
  currentZoom: number,
  currentPanX: number,
  currentPanY: number,
  cursorX: number,
  cursorY: number,
  nextZoom: number,
): { zoom: number; panX: number; panY: number } {
  const clamped = clampZoom(nextZoom);
  // 같은 zoom 이면 pan 변경 없음 — 사용자 입력이 noop 일 때 보정 비용 0.
  if (clamped === currentZoom) {
    return { zoom: currentZoom, panX: currentPanX, panY: currentPanY };
  }
  const safeCurrent = currentZoom <= 0 ? 1 : currentZoom;
  // cursor 가 가리키는 design 좌표 (현재 zoom 기준)
  const cx = (cursorX - currentPanX) / safeCurrent;
  const cy = (cursorY - currentPanY) / safeCurrent;
  // 새 zoom 에서 같은 design 좌표가 같은 cursor 위치를 가리키도록 pan 보정
  return {
    zoom: clamped,
    panX: cursorX - cx * clamped,
    panY: cursorY - cy * clamped,
  };
}

/**
 * "fit to viewport" zoom — 캔버스 전체가 viewport 안에 들어오도록 하는 zoom 배율.
 *
 * 이미지가 viewport 보다 작으면 1 (확대 안 함, Figma 동일 동작).
 * `padding` 은 viewport 가장자리에서 띄울 px (기본 32 — UI chrome 여유).
 */
export function calcFitZoom(
  imageW: number,
  imageH: number,
  viewportW: number,
  viewportH: number,
  padding = 32,
): number {
  if (imageW <= 0 || imageH <= 0 || viewportW <= 0 || viewportH <= 0) return 1;
  const availableW = Math.max(1, viewportW - padding * 2);
  const availableH = Math.max(1, viewportH - padding * 2);
  const ratioW = availableW / imageW;
  const ratioH = availableH / imageH;
  const fit = Math.min(ratioW, ratioH);
  // 이미지가 viewport 보다 작으면 1 로 (확대 X)
  if (fit >= 1) return 1;
  return clampZoom(fit);
}

/**
 * fit zoom 적용 시 캔버스를 viewport 안에서 가운데 정렬하는 panX/panY.
 *
 * 사용:
 *   const fit = calcFitZoom(...);
 *   const { panX, panY } = centerPan(imageW, imageH, viewportW, viewportH, fit);
 */
export function centerPan(
  imageW: number,
  imageH: number,
  viewportW: number,
  viewportH: number,
  zoom: number,
): { panX: number; panY: number } {
  return {
    panX: (viewportW - imageW * zoom) / 2,
    panY: (viewportH - imageH * zoom) / 2,
  };
}

/**
 * pan delta 적용 (드래그 이벤트 1회분).
 * design space 가 아닌 screen space delta 를 그대로 더한다 — 드래그는 화면 픽셀 기준.
 *
 * 향후 viewport bound clamp (canvas 가 viewport 밖으로 완전히 사라지는 걸 방지)
 * 를 추가할 수 있지만, MVP 는 자유 pan 으로 두어 사용자가 캔버스 밖 빈 공간으로
 * 자유롭게 이동할 수 있게 한다 (Figma 와 동일).
 */
export function applyPanDelta(
  panX: number,
  panY: number,
  dx: number,
  dy: number,
): { panX: number; panY: number } {
  return { panX: panX + dx, panY: panY + dy };
}

/**
 * Wheel event 의 deltaY 를 zoom 배율 배수로 변환.
 *
 * 브라우저 별로 deltaY 의 절댓값이 다르므로 (Chrome ~100, Firefox ~3, trackpad
 * pinch ~10) 단순 비례가 아닌 deceleration 적용. exp(deltaY * factor) 형태로
 * 작은 wheel 도 부드럽게, 큰 deltaY 도 폭주 없게.
 *
 * 기본 factor 0.005 → deltaY=100 일 때 zoom *= e^-0.5 ≈ 0.61 (한 번의 스크롤로
 * 약 60% 축소, 다음 스크롤로 36% 등 — Figma 의 wheel 응답과 비슷).
 *
 * 양수 deltaY = 위로 휠 = 축소(<1), 음수 deltaY = 아래로 휠 = 확대(>1) 의 자연
 * 동작은 다음 컴포넌트에서 부호를 반전해서 호출하면 됨.
 */
export function wheelToZoomFactor(deltaY: number, factor = 0.005): number {
  return Math.exp(-deltaY * factor);
}
