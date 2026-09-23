import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { updateScheduleTemplate } from "@/meloming/domains/schedule-template/apis/schedule-templates";
import { scheduleTemplateKeys } from "@/meloming/domains/schedule-template/query-keys";
import type {
  ScheduleTemplate,
  UpdateScheduleTemplateRequest,
} from "@/meloming/domains/schedule-template/types";

/**
 * 주간 시간표 템플릿 수정 mutation.
 *
 * 백엔드: `PATCH /v1/schedule-templates/:id` — 채널 소유자/매니저.
 * 성공 시 detail + 해당 채널 list invalidate.
 *
 * 주의: nullable 필드(originalPsdUrl/thumbnailUrl)는 body 에 `null` 을 직접
 * 넣어 clear 가능. non-null 필드는 `undefined` 로 남겨야 하며 null 전송 시
 * 백엔드가 400.
 *
 * Feature flag: `channelScheduleTemplate`.
 */
export function useUpdateScheduleTemplate(): UseMutationResult<
  ScheduleTemplate,
  Error,
  { id: number; body: UpdateScheduleTemplateRequest }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }) => updateScheduleTemplate(id, body),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({
        queryKey: scheduleTemplateKeys.detail(variables.id),
      });
      queryClient.invalidateQueries({
        queryKey: scheduleTemplateKeys.list(data.channelId),
      });
    },
  });
}
