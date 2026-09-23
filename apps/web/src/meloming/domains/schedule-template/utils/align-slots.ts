/**
 * 다중 슬롯 정렬 / 분배 유틸 (Phase 2B Figma 패리티).
 *
 * 모두 **순수 함수** — 입력 슬롯 배열을 변경하지 않고 새 배열을 반환한다.
 * 호출 측은 결과를 `editor.setState` 로 spec 에 반영.
 *
 * 정책:
 *  - 슬롯이 1개 이하면 정렬할 대상이 없으므로 입력 그대로 반환 (no-op).
 *  - 회전된(`rotation !== 0`) 슬롯도 좌표 자체는 변경 가능 — 회전은 슬롯 중심 기준
 *    이므로 bounding box 경계는 axis-aligned (x, y, w, h) 만으로 정의된다.
 *  - 좌표는 항상 정수로 round 한다 (캔버스 픽셀 정합성).
 */

import type { TemplateSlot } from "@/meloming/domains/schedule-template/types/template-spec";

/**
 * 정렬 axis 와 방향. 6 가지.
 *
 * - `left` / `centerH` / `right`     : 가로축 (x)
 * - `top` / `centerV` / `bottom`     : 세로축 (y)
 */
export type AlignKind =
  | "left"
  | "centerH"
  | "right"
  | "top"
  | "centerV"
  | "bottom";

/**
 * 분배 axis. 가로/세로 균등 간격.
 */
export type DistributeKind = "horizontal" | "vertical";

/**
 * 슬롯 배열의 axis-aligned bounding box (min/max).
 * 슬롯이 비면 null.
 */
export interface SlotBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * 슬롯 배열의 bbox 계산. 회전은 무시하고 raw x/y/w/h 만 사용.
 */
export function computeBounds(slots: TemplateSlot[]): SlotBounds | null {
  if (slots.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of slots) {
    if (s.x < minX) minX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.x + s.w > maxX) maxX = s.x + s.w;
    if (s.y + s.h > maxY) maxY = s.y + s.h;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * 6 종 정렬을 통일적으로 처리.
 *
 * - left / right     → 동일 x 로 맞춤 (right 는 우측 edge 정렬)
 * - centerH          → bounds 의 가로 중심을 슬롯의 가로 중심에 맞춤
 * - top / bottom     → 동일 y / 하단 edge 정렬
 * - centerV          → bounds 의 세로 중심을 슬롯의 세로 중심에 맞춤
 */
export function alignSlots(
  slots: TemplateSlot[],
  kind: AlignKind,
): TemplateSlot[] {
  if (slots.length < 2) return slots;
  const bounds = computeBounds(slots);
  if (!bounds) return slots;

  return slots.map((slot) => {
    switch (kind) {
      case "left":
        return setX(slot, bounds.minX);
      case "right":
        return setX(slot, bounds.maxX - slot.w);
      case "centerH": {
        const cx = (bounds.minX + bounds.maxX) / 2;
        return setX(slot, cx - slot.w / 2);
      }
      case "top":
        return setY(slot, bounds.minY);
      case "bottom":
        return setY(slot, bounds.maxY - slot.h);
      case "centerV": {
        const cy = (bounds.minY + bounds.maxY) / 2;
        return setY(slot, cy - slot.h / 2);
      }
    }
  });
}

/**
 * 가로/세로 균등 분배.
 *
 * 알고리즘 (가로 기준):
 *  1) 슬롯을 x 기준 정렬. (입력 순서 보존하지 않고, 좌→우 순서로 재배치.)
 *  2) leftmost / rightmost 슬롯의 위치는 고정.
 *  3) 가운데 슬롯들은 인접 슬롯과의 gap 이 모두 동일해지도록 재배치.
 *     - totalContentW = sum(slot.w)
 *     - availableW    = (rightmost.x + rightmost.w) - leftmost.x
 *     - totalGap      = availableW - totalContentW
 *     - gap           = totalGap / (n - 1)
 *
 * 슬롯이 2개 이하면 분배할 대상이 없으므로 no-op.
 *
 * 결과 슬롯 순서는 입력 배열의 순서를 보존 (id 기준 매핑) — z-index 보존을 위해.
 */
export function distributeSlots(
  slots: TemplateSlot[],
  kind: DistributeKind,
): TemplateSlot[] {
  if (slots.length < 3) return slots;

  if (kind === "horizontal") {
    const sorted = [...slots].sort((a, b) => a.x - b.x);
    const leftmost = sorted[0];
    const rightmost = sorted[sorted.length - 1];
    const availableW = rightmost.x + rightmost.w - leftmost.x;
    const totalContentW = sorted.reduce((sum, s) => sum + s.w, 0);
    const totalGap = availableW - totalContentW;
    const gap = totalGap / (sorted.length - 1);
    const newXById: Record<string, number> = {};
    let cursor = leftmost.x;
    for (const s of sorted) {
      newXById[s.id] = cursor;
      cursor += s.w + gap;
    }
    return slots.map((s) =>
      s.id in newXById ? setX(s, newXById[s.id]) : s,
    );
  }

  // vertical
  const sorted = [...slots].sort((a, b) => a.y - b.y);
  const topmost = sorted[0];
  const bottommost = sorted[sorted.length - 1];
  const availableH = bottommost.y + bottommost.h - topmost.y;
  const totalContentH = sorted.reduce((sum, s) => sum + s.h, 0);
  const totalGap = availableH - totalContentH;
  const gap = totalGap / (sorted.length - 1);
  const newYById: Record<string, number> = {};
  let cursor = topmost.y;
  for (const s of sorted) {
    newYById[s.id] = cursor;
    cursor += s.h + gap;
  }
  return slots.map((s) =>
    s.id in newYById ? setY(s, newYById[s.id]) : s,
  );
}

function setX(slot: TemplateSlot, x: number): TemplateSlot {
  return { ...slot, x: Math.round(x) } as TemplateSlot;
}

function setY(slot: TemplateSlot, y: number): TemplateSlot {
  return { ...slot, y: Math.round(y) } as TemplateSlot;
}
