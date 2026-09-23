import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { deleteScheduleTemplate } from "@/meloming/domains/schedule-template/apis/schedule-templates";
import { scheduleTemplateKeys } from "@/meloming/domains/schedule-template/query-keys";
import type { DeleteScheduleTemplateResponse } from "@/meloming/domains/schedule-template/types";

/**
 * 주간 시간표 템플릿 삭제 (soft delete) mutation.
 *
 * 백엔드: `DELETE /v1/schedule-templates/:id` — 채널 소유자/매니저.
 * `channelId` 는 caller 가 함께 넘겨야 한다 — 서버 응답이 `{ success: true }` 만
 * 돌려주므로 invalidate 대상 list 를 특정하려면 변수로 필요.
 *
 * 성공 시 detail 제거 + 해당 채널 list invalidate.
 * Feature flag: `channelScheduleTemplate`.
 */
export function useDeleteScheduleTemplate(): UseMutationResult<
  DeleteScheduleTemplateResponse,
  Error,
  { id: number; channelId: number }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }) => deleteScheduleTemplate(id),
    onSuccess: (_data, variables) => {
      queryClient.removeQueries({
        queryKey: scheduleTemplateKeys.detail(variables.id),
      });
      queryClient.invalidateQueries({
        queryKey: scheduleTemplateKeys.list(variables.channelId),
      });
    },
  });
}
