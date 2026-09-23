import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { createScheduleRender } from "@/meloming/domains/schedule-template/apis/schedule-renders";
import { scheduleRenderKeys } from "@/meloming/domains/schedule-template/query-keys";
import type {
  CreateScheduleRenderRequest,
  ScheduleImageRender,
} from "@/meloming/domains/schedule-template/types";

/**
 * 주간 시간표 이미지 렌더 요청 (큐 enqueue) mutation.
 *
 * 백엔드: `POST /v1/schedule-renders` — 202 Accepted, status=QUEUED.
 * 성공 시 반환된 render 를 cache 에 미리 심어두고, 호출 측은
 * `useScheduleRender(render.id)` 로 폴링을 시작한다.
 *
 * Feature flag: `channelScheduleTemplate`.
 */
export function useCreateScheduleRender(): UseMutationResult<
  ScheduleImageRender,
  Error,
  CreateScheduleRenderRequest
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body) => createScheduleRender(body),
    onSuccess: (data) => {
      // 초기 QUEUED 응답을 detail cache 에 심어두면 폴링 훅 첫 frame 이
      // 네트워크 없이 즉시 status 를 그릴 수 있다.
      queryClient.setQueryData(scheduleRenderKeys.detail(data.id), data);
    },
  });
}
