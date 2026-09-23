/**
 * `schedule-sns-publications` 도메인의 TanStack Query key factory.
 *
 * 컨벤션은 `schedule-template/query-keys.ts` 와 동일한 패턴 (all → list/detail).
 *  - byRender(renderId): 한 렌더의 게시 내역 목록
 *  - detail(id):         단일 게시 레코드 (폴링용 fallback — 일반적으로
 *                        byRender 캐시에서 derived 가 우선)
 */
export const scheduleSnsPublicationKeys = {
  all: ["schedule-sns-publications"] as const,
  byRenders: () =>
    [...scheduleSnsPublicationKeys.all, "by-render"] as const,
  byRender: (renderId: number) =>
    [...scheduleSnsPublicationKeys.byRenders(), renderId] as const,
  details: () =>
    [...scheduleSnsPublicationKeys.all, "detail"] as const,
  detail: (id: number) =>
    [...scheduleSnsPublicationKeys.details(), id] as const,
};
