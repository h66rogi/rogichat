/**
 * 마키 (선택 사각형) 영역과 슬롯의 교차 판정 (Phase 2B).
 *
 * 캔버스 빈 영역에서 mousedown → mousemove → mouseup 으로 그리는 박스가
 * 어떤 슬롯들과 겹치는지 계산. 결과는 multi-select 에 사용.
 *
 * 정책:
 *  - 슬롯의 visual axis-aligned bounding box (AABB) 와의 intersection.
 *    회전된 슬롯은 회전을 고려한 AABB 로 확장되어 평가된다 (Phase 2B IMPORTANT
 *    fix — 2B-5: rotation > 0 이면 raw x/y/w/h 가 시각 박스보다 작으므로 회전된
 *    꼭지점들의 bounding box 로 보정).
 *  - 박스가 슬롯 안에 완전히 포함되어도 OK, 겹치기만 해도 OK (Figma 와 동일).
 *  - 마키 영역의 음수 width/height (드래그 방향 반전) 도 정상 처리.
 */

import type { TemplateSlot } from "@/meloming/domains/schedule-template/types/template-spec";

/**
 * (x, y) 시작점에서 (w, h) 의 사각형. w/h 는 음수일 수 있다 (드래그 반전).
 * `normalizeMarquee` 가 항상 양수 폭으로 정규화한다.
 */
export interface MarqueeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 음수 폭/높이를 양수로 정규화. 드래그가 우→좌 또는 하→상 방향이어도
 * intersection 계산이 일관되게 동작.
 */
export function normalizeMarquee(rect: MarqueeRect): MarqueeRect {
  const x = rect.w < 0 ? rect.x + rect.w : rect.x;
  const y = rect.h < 0 ? rect.y + rect.h : rect.y;
  const w = Math.abs(rect.w);
  const h = Math.abs(rect.h);
  return { x, y, w, h };
}

/**
 * 두 박스가 겹치는지 — strict 가 아닌 inclusive (edge 가 닿으면 겹침으로 간주).
 *
 * Figma 패리티: 마우스가 슬롯 가장자리에 살짝 닿기만 해도 선택되어야 한다.
 */
function rectsIntersect(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  if (a.x + a.w < b.x) return false;
  if (b.x + b.w < a.x) return false;
  if (a.y + a.h < b.y) return false;
  if (b.y + b.h < a.y) return false;
  return true;
}

/**
 * 회전된 슬롯의 axis-aligned bounding box (AABB) 계산 (Phase 2B IMPORTANT fix).
 *
 * 슬롯은 transform-origin: center 로 회전되므로, 회전된 사각형의 4개 꼭지점이
 * 형성하는 AABB 의 폭/높이는 다음과 같다:
 *   newW = |w·cos(θ)| + |h·sin(θ)|
 *   newH = |w·sin(θ)| + |h·cos(θ)|
 *
 * 결과 AABB 는 슬롯 중심 (cx, cy) 를 동일하게 유지하며 새 폭/높이로 확장.
 * rotation 이 0 또는 누락이면 원본 박스 그대로 반환 (회전 없음 → 비용 0).
 *
 * 예) w=100, h=40, rotation=90 → newW=40, newH=100 (가로/세로 swap, 중심 유지)
 *     w=100, h=40, rotation=45 → newW=newH≈98.99 (디자인 박스 대각선)
 */
export function rotatedAABB(slot: {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
}): { x: number; y: number; w: number; h: number } {
  const rot = slot.rotation ?? 0;
  // 360 의 정수배는 회전 없음과 동일.
  const norm = ((rot % 360) + 360) % 360;
  if (norm === 0) {
    return { x: slot.x, y: slot.y, w: slot.w, h: slot.h };
  }
  const rad = (norm * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const newW = slot.w * cos + slot.h * sin;
  const newH = slot.w * sin + slot.h * cos;
  // 슬롯 중심 (백엔드 canvas-renderer + 프리뷰 transform-origin: center 와 일치).
  const cx = slot.x + slot.w / 2;
  const cy = slot.y + slot.h / 2;
  return {
    x: cx - newW / 2,
    y: cy - newH / 2,
    w: newW,
    h: newH,
  };
}

/**
 * 마키 영역과 교차하는 모든 슬롯 ID 를 반환.
 *
 * 입력 슬롯 배열의 순서를 보존한다 (z-index 기준 정렬 가정).
 * 회전된 슬롯은 회전된 AABB 로 평가하여 시각적 박스와 일치한다.
 */
export function slotsIntersectingMarquee(
  slots: TemplateSlot[],
  marquee: MarqueeRect,
): string[] {
  const m = normalizeMarquee(marquee);
  const result: string[] = [];
  for (const s of slots) {
    if (rectsIntersect(m, rotatedAABB(s))) {
      result.push(s.id);
    }
  }
  return result;
}

/**
 * 단순 boolean 판정 — 단일 슬롯이 마키 안에 걸리는지.
 * 회전된 슬롯도 AABB 기반으로 시각 박스를 정확히 따른다.
 */
export function slotIntersectsMarquee(
  slot: TemplateSlot,
  marquee: MarqueeRect,
): boolean {
  const m = normalizeMarquee(marquee);
  return rectsIntersect(m, rotatedAABB(slot));
}
