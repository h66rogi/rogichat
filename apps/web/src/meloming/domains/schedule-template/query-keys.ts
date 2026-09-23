/**
 * `schedule-template` 도메인의 TanStack Query key factory.
 *
 * 기존 `src/domains/schedule/hooks/use-schedules.ts` 의 `scheduleKeys` 와
 * 동일한 패턴. 확장 시 변경된 `channelId` / `id` 범위로 부분 invalidate 가능.
 */
export const scheduleTemplateKeys = {
  all: ["schedule-templates"] as const,
  lists: () => [...scheduleTemplateKeys.all, "list"] as const,
  list: (channelId: number) =>
    [...scheduleTemplateKeys.lists(), channelId] as const,
  details: () => [...scheduleTemplateKeys.all, "detail"] as const,
  detail: (id: number) => [...scheduleTemplateKeys.details(), id] as const,
};

export const scheduleRenderKeys = {
  all: ["schedule-renders"] as const,
  details: () => [...scheduleRenderKeys.all, "detail"] as const,
  detail: (id: number) => [...scheduleRenderKeys.details(), id] as const,
};
