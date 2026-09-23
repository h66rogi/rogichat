/**
 * 슬롯 드래그 시 snap-to-grid + snap-to-slot 좌표 보정 유틸 (Phase 2B Figma 패리티).
 *
 * 모두 **순수 함수** — 캔버스 컴포넌트의 `onDrag` 콜백에서 호출되어 스냅 후 좌표를 반환.
 * 가이드 라인 그리기는 캔버스 컴포넌트가 별도로 처리.
 *
 * 정책 (Phase 2B IMPORTANT fix — 우선순위 카테고리 분리):
 *  - 후보를 "all-in pool" 로 모아 가까운 것을 채택하면 카테고리 우선순위가 깨진다.
 *    예) 슬롯 후보가 4px 이내이고 캔버스 후보가 1px 이내이면 캔버스가 채택되어
 *        문서화된 "슬롯 > 캔버스 > 그리드" 순서가 위반된다.
 *  - 이 모듈은 카테고리별로 후보를 만들고, 한 카테고리 안에서 threshold 이내 가장 가까운
 *    후보를 1차 채택한다. 매치된 카테고리가 있으면 다음 카테고리는 평가하지 않는다.
 *  - x / y 축은 독립적으로 같은 우선순위 평가를 거친다 — 한 축에서 슬롯 매치, 다른 축에서
 *    그리드 매치도 가능.
 *  - 자기 자신은 후보에서 제외 (드래그 중인 슬롯).
 */

import type { TemplateSlot } from "@/meloming/domains/schedule-template/types/template-spec";

export const DEFAULT_SNAP_THRESHOLD = 4;
export const DEFAULT_GRID_SIZE = 8;

export interface SnapResult {
  /** 스냅 후 x 좌표 (정수). 스냅이 없었으면 입력 그대로 round). */
  x: number;
  /** 스냅 후 y 좌표 (정수). */
  y: number;
  /** 가로축 가이드 라인이 표시되어야 하는 x 좌표. 스냅 미발생 시 null. */
  guideX: number | null;
  /** 세로축 가이드 라인이 표시되어야 하는 y 좌표. 스냅 미발생 시 null. */
  guideY: number | null;
}

export interface SnapOptions {
  /** 그리드 크기 (px). 0/음수면 그리드 스냅 비활성. */
  gridSize?: number;
  /** 스냅 활성 거리 (px). 기본 4. */
  threshold?: number;
  /** 그리드 스냅 활성 여부. */
  gridEnabled?: boolean;
  /** 슬롯 스냅 활성 여부. */
  slotEnabled?: boolean;
  /** 캔버스 (베이스 이미지) 폭. 캔버스 edge / center 스냅 후보. */
  canvasW: number;
  /** 캔버스 (베이스 이미지) 높이. */
  canvasH: number;
}

/**
 * 한 축의 axis snap 후보. `target` 은 가이드 라인이 그려질 절대 좌표.
 * `point` 는 dragging 슬롯의 어느 점 (left/center/right) 이 target 과 매치되는지.
 */
interface AxisCandidate {
  /** 가이드/스냅 라인의 절대 좌표 (예: 다른 슬롯의 left edge x = 200) */
  target: number;
}

/**
 * 한 축에서 dragging 슬롯의 left/center/right 가 어떤 candidate 와 가장 가까운지 평가한 결과.
 * threshold 안쪽 매치가 없으면 null.
 */
interface AxisSnap {
  /** dragging 슬롯의 보정된 좌상단 좌표 */
  value: number;
  /** 가이드 라인이 그려질 절대 좌표 (target) */
  guide: number;
  /** dragging 좌표와 candidate 의 거리 (작을수록 가까움) */
  distance: number;
}

/**
 * 한 축에서 candidates 와 dragging 슬롯의 left/center/right 매치 후보 중
 * threshold 이내 가장 가까운 결과를 반환. 없으면 null.
 *
 * `size` 는 dragging 슬롯의 그 축 크기 (w 또는 h).
 * `value` 는 dragging 슬롯의 그 축 좌상단 좌표 (newX 또는 newY).
 */
function pickFirstSnap(
  candidates: AxisCandidate[],
  value: number,
  size: number,
  threshold: number,
): AxisSnap | null {
  let best: AxisSnap | null = null;
  for (const c of candidates) {
    // dragging 슬롯의 어느 점이 candidate 와 매치되어야 하는지 — left/center/right 모두 시도.
    const tries: number[] = [
      c.target, // 슬롯 left 가 target 위 → newValue = target
      c.target - size / 2, // 슬롯 center 가 target 위 → newValue = target - size/2
      c.target - size, // 슬롯 right 가 target 위 → newValue = target - size
    ];
    for (const tryValue of tries) {
      const dist = Math.abs(value - tryValue);
      if (dist > threshold) continue;
      if (best === null || dist < best.distance) {
        best = { value: tryValue, guide: c.target, distance: dist };
      }
    }
  }
  return best;
}

/**
 * 다른 슬롯들의 left/right/center 를 한 축의 후보로.
 *
 * Phase 2C-2 fix: hidden 슬롯은 캔버스에 보이지 않으므로 가이드 라인이 떠도 사용자가
 * 의미를 알 수 없다 → 후보에서 제외. (locked 슬롯은 시각적으로 보이므로 후보 유지.)
 */
function buildSlotXCandidates(
  others: TemplateSlot[],
  draggingId: string,
): AxisCandidate[] {
  const out: AxisCandidate[] = [];
  for (const o of others) {
    if (o.id === draggingId) continue;
    if (o.hidden === true) continue;
    out.push(
      { target: o.x }, // left
      { target: o.x + o.w }, // right
      { target: o.x + o.w / 2 }, // center
    );
  }
  return out;
}

function buildSlotYCandidates(
  others: TemplateSlot[],
  draggingId: string,
): AxisCandidate[] {
  const out: AxisCandidate[] = [];
  for (const o of others) {
    if (o.id === draggingId) continue;
    if (o.hidden === true) continue;
    out.push(
      { target: o.y }, // top
      { target: o.y + o.h }, // bottom
      { target: o.y + o.h / 2 }, // center
    );
  }
  return out;
}

/** 캔버스 left/right/center edge 후보 한 쌍. */
function buildCanvasXCandidates(canvasW: number): AxisCandidate[] {
  return [{ target: 0 }, { target: canvasW }, { target: canvasW / 2 }];
}
function buildCanvasYCandidates(canvasH: number): AxisCandidate[] {
  return [{ target: 0 }, { target: canvasH }, { target: canvasH / 2 }];
}

/**
 * 그리드 fallback — value 와 가장 가까운 grid line 으로의 스냅.
 * gridSize <= 0 이면 비활성. threshold 초과면 null.
 *
 * 그리드 스냅은 가이드 라인을 그리지 않으므로 AxisSnap.guide 의 의미는
 * "스냅 발생 여부" 만. 호출 측에서 guide 를 null 로 매핑한다.
 */
function pickGridSnap(
  value: number,
  gridSize: number,
  threshold: number,
): AxisSnap | null {
  if (gridSize <= 0) return null;
  const nearest = Math.round(value / gridSize) * gridSize;
  const dist = Math.abs(value - nearest);
  if (dist > threshold) return null;
  return { value: nearest, guide: nearest, distance: dist };
}

/**
 * 드래그 중인 슬롯의 새 좌표를 받아 스냅 보정.
 *
 * @param dragging       드래그 중인 슬롯 (현재 위치는 무시 — 새 좌표는 newX/newY)
 * @param newX           드래그가 제안하는 새 x 좌표
 * @param newY           드래그가 제안하는 새 y 좌표
 * @param otherSlots     다른 모든 슬롯 (자기 자신은 자동 제외, hidden 슬롯도 후보에서 자동 제외)
 * @param options        스냅 옵션
 *
 * 우선순위 (Phase 2B IMPORTANT fix — 카테고리 1차 채택 후 다음 카테고리 미평가):
 *  1. 슬롯 스냅 (threshold 이내) — 다른 슬롯의 left/right/center/top/bottom 과 매치되면 채택
 *  2. 캔버스 edge / center 스냅
 *  3. 그리드 스냅 (gridSize 단위)
 *  4. 어느 것에도 안 걸리면 round 만 적용
 *
 * 한 축이 슬롯 카테고리에서 매치되었더라도 다른 축은 독립적으로 같은 우선순위 평가를 받는다.
 * → x 는 슬롯, y 는 그리드 매치 같은 조합도 가능. 단 같은 축 안에서는 카테고리 우선순위가 강제된다.
 *
 * Phase 2C-2 fix: hidden 슬롯은 화면에 보이지 않으므로 스냅 가이드 후보에서 제외된다.
 * 캔버스 컴포넌트가 slots prop 통째로 넘겨도 hidden 은 자동 필터됨.
 */
export function computeSnap(
  dragging: TemplateSlot,
  newX: number,
  newY: number,
  otherSlots: TemplateSlot[],
  options: SnapOptions,
): SnapResult {
  const {
    gridSize = DEFAULT_GRID_SIZE,
    threshold = DEFAULT_SNAP_THRESHOLD,
    gridEnabled = true,
    slotEnabled = true,
    canvasW,
    canvasH,
  } = options;

  const w = dragging.w;
  const h = dragging.h;

  // x 축 카테고리 우선순위 평가
  let snappedX = newX;
  let guideX: number | null = null;
  const xSlot = slotEnabled
    ? pickFirstSnap(
        buildSlotXCandidates(otherSlots, dragging.id),
        newX,
        w,
        threshold,
      )
    : null;
  if (xSlot) {
    snappedX = xSlot.value;
    guideX = xSlot.guide;
  } else {
    const xCanvas = pickFirstSnap(
      buildCanvasXCandidates(canvasW),
      newX,
      w,
      threshold,
    );
    if (xCanvas) {
      snappedX = xCanvas.value;
      guideX = xCanvas.guide;
    } else if (gridEnabled) {
      const xGrid = pickGridSnap(newX, gridSize, threshold);
      if (xGrid) {
        snappedX = xGrid.value;
        // 그리드 스냅은 가이드 라인을 그리지 않는다 (시각적 노이즈 회피).
        guideX = null;
      }
    }
  }

  // y 축 카테고리 우선순위 평가
  let snappedY = newY;
  let guideY: number | null = null;
  const ySlot = slotEnabled
    ? pickFirstSnap(
        buildSlotYCandidates(otherSlots, dragging.id),
        newY,
        h,
        threshold,
      )
    : null;
  if (ySlot) {
    snappedY = ySlot.value;
    guideY = ySlot.guide;
  } else {
    const yCanvas = pickFirstSnap(
      buildCanvasYCandidates(canvasH),
      newY,
      h,
      threshold,
    );
    if (yCanvas) {
      snappedY = yCanvas.value;
      guideY = yCanvas.guide;
    } else if (gridEnabled) {
      const yGrid = pickGridSnap(newY, gridSize, threshold);
      if (yGrid) {
        snappedY = yGrid.value;
        guideY = null;
      }
    }
  }

  return {
    x: Math.round(snappedX),
    y: Math.round(snappedY),
    guideX,
    guideY,
  };
}

/**
 * 그리드 스냅 단독 — 슬롯 스냅 없이 그리드만 평가.
 * 단위 테스트 편의 + 가벼운 호출용 헬퍼.
 */
export function snapToGrid(
  value: number,
  gridSize = DEFAULT_GRID_SIZE,
  threshold = DEFAULT_SNAP_THRESHOLD,
): number {
  if (gridSize <= 0) return Math.round(value);
  const nearest = Math.round(value / gridSize) * gridSize;
  if (Math.abs(value - nearest) <= threshold) return nearest;
  return Math.round(value);
}
