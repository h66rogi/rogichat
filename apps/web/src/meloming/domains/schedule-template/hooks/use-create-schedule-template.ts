import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { createScheduleTemplate } from "@/meloming/domains/schedule-template/apis/schedule-templates";
import { scheduleTemplateKeys } from "@/meloming/domains/schedule-template/query-keys";
import type {
  CreateScheduleTemplateRequest,
  ScheduleTemplate,
} from "@/meloming/domains/schedule-template/types";

/**
 * 주간 시간표 템플릿 생성 mutation.
 *
 * 백엔드: `POST /v1/schedule-templates` — 채널 소유자/매니저.
 * 성공 시 해당 채널 목록 쿼리 invalidate.
 * Feature flag: `channelScheduleTemplate`.
 */
export function useCreateScheduleTemplate(): UseMutationResult<
  ScheduleTemplate,
  Error,
  CreateScheduleTemplateRequest
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body) => createScheduleTemplate(body),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: scheduleTemplateKeys.list(variables.channelId),
      });
    },
  });
}
