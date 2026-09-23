import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { publishScheduleRender } from "@/meloming/domains/schedule-sns-publications/apis/schedule-sns-publications";
import { scheduleSnsPublicationKeys } from "@/meloming/domains/schedule-sns-publications/query-keys";
import type {
  CreateScheduleSnsPublicationRequest,
  ScheduleSnsPublication,
} from "@/meloming/domains/schedule-sns-publications/types";

interface UsePublishScheduleRenderVariables {
  renderId: number;
  body: CreateScheduleSnsPublicationRequest;
}

interface UsePublishScheduleRenderOptions {
  onSuccess?: (data: ScheduleSnsPublication) => void;
  onError?: (error: Error) => void;
}

/**
 * `POST /v1/schedule-renders/:renderId/publish` 뮤테이션.
 *
 * 성공 시:
 *  - 해당 렌더의 publications 목록 캐시에 새 레코드를 prepend (즉시 반영,
 *    네트워크 race 방지). invalidate 도 트리거하여 서버 truth 와 reconcile.
 *  - detail 캐시에도 미리 심어둔다 — `useScheduleSnsPublication` 폴링이
 *    첫 frame 부터 status 를 표시할 수 있도록.
 *
 * 실패 시 toast 등 후처리는 호출 측 책임. (헬퍼 hook 이 코드 매핑/에러
 * 메시지를 결정하는 게 아니라, 화면 컴포넌트가 사용자 컨텍스트에 맞춘
 * 메시지를 보여주도록 책임 분리.)
 */
export function usePublishScheduleRender(
  options?: UsePublishScheduleRenderOptions,
): UseMutationResult<
  ScheduleSnsPublication,
  Error,
  UsePublishScheduleRenderVariables
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ renderId, body }) => publishScheduleRender(renderId, body),
    onSuccess: (data) => {
      // 새 레코드를 list 캐시 head 에 즉시 반영. 서버 reconcile 은 invalidate
      // 가 cover.
      queryClient.setQueryData<ScheduleSnsPublication[] | undefined>(
        scheduleSnsPublicationKeys.byRender(data.renderId),
        (prev) => {
          if (!prev) return [data];
          // 동일 id 가 있으면 교체, 없으면 prepend.
          const filtered = prev.filter((row) => row.id !== data.id);
          return [data, ...filtered];
        },
      );
      queryClient.setQueryData(
        scheduleSnsPublicationKeys.detail(data.id),
        data,
      );
      // 폴링이 즉시 fresh 한 결과를 가져갈 수 있도록 invalidate.
      queryClient.invalidateQueries({
        queryKey: scheduleSnsPublicationKeys.byRender(data.renderId),
        // setQueryData 직후 즉각 refetch 는 불필요 (낙관적 prepend 가 이미 fresh).
        refetchType: "none",
      });
      options?.onSuccess?.(data);
    },
    onError: (error) => {
      options?.onError?.(error);
    },
  });
}
