/**
 * 슬롯 그룹 (Phase 2C — Figma 패리티) 순수 함수 유틸.
 *
 * 그룹 정책:
 *  - `slot.groupId` 가 같은 슬롯들은 한 슬롯을 선택하면 모두 함께 선택.
 *  - 한 슬롯을 드래그하면 같은 delta 가 모든 멤버에 적용.
 *  - 그룹 해제는 선택된 슬롯들의 groupId 만 제거 (다른 같은 그룹 멤버는 유지).
 *
 * 에디터 컴포넌트 / 캔버스 컴포넌트 / 테스트가 같은 로직을 공유한다.
 */

import type { TemplateSlot } from "@/meloming/domains/schedule-template/types/template-spec";

/**
 * `slots` 안에서 같은 `groupId` 를 공유하는 모든 슬롯의 ID 목록.
 * 입력 슬롯 한 개의 ID 와 groupId 를 받아 같은 그룹 멤버 모두를 반환.
 *
 * - groupId 가 없으면 입력 ID 만 반환 (단일 슬롯 취급).
 * - 빈 슬롯 배열이면 입력 ID 만 반환.
 */
export function expandGroupMembers(
  slots: TemplateSlot[],
  id: string,
): string[] {
  const target = slots.find((s) => s.id === id);
  if (!target) return [id];
  if (!target.groupId) return [id];
  return slots.filter((s) => s.groupId === target.groupId).map((s) => s.id);
}

/**
 * 마키 결과 등 ID 집합에 그룹 멤버를 union 으로 확장.
 *  - 입력 ID 들 중 groupId 가 있는 슬롯의 모든 그룹 멤버를 추가.
 *  - 결과는 중복 제거된 ID 배열.
 *
 * 그룹 멤버 일부만 마키에 잡혔을 때 그룹 전체로 확장하는 데 사용.
 */
export function expandSelectionWithGroups(
  slots: TemplateSlot[],
  ids: string[],
): string[] {
  const idSet = new Set(ids);
  const expanded = new Set<string>(ids);
  for (const s of slots) {
    if (!s.groupId) continue;
    if (!idSet.has(s.id)) continue;
    for (const sib of slots) {
      if (sib.groupId === s.groupId) expanded.add(sib.id);
    }
  }
  return Array.from(expanded);
}

/**
 * 슬롯 일괄 이동. ids 에 해당하는 슬롯에만 (dx, dy) 를 더한다.
 * 다른 슬롯은 동일 인스턴스 그대로 반환 (referential equality 보존 → React 최적화 도움).
 *
 * dx=0 && dy=0 이면 원본 배열을 그대로 반환.
 */
export function applyMoveDelta(
  slots: TemplateSlot[],
  ids: string[],
  dx: number,
  dy: number,
): TemplateSlot[] {
  if (ids.length === 0) return slots;
  if (dx === 0 && dy === 0) return slots;
  const idSet = new Set(ids);
  return slots.map((s) =>
    idSet.has(s.id) ? { ...s, x: s.x + dx, y: s.y + dy } : s,
  );
}

/**
 * 새 그룹 ID 생성. 충돌 회피 + 디버그 가독성을 위해 prefix `g-` + epoch + short.
 */
export function createGroupId(): string {
  const short = Math.random().toString(36).slice(2, 7);
  return `g-${Date.now().toString(36)}-${short}`;
}
