import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import { parsePsd } from "@/meloming/domains/schedule-template/apis/schedule-templates";
import type { ParsePsdResponse } from "@/meloming/domains/schedule-template/types";

/**
 * PSD 업로드 + 자동 슬롯 추출 mutation (F8 Phase 1).
 *
 * 백엔드: `POST /v1/schedule-templates/psd-parse` — 채널 소유자/매니저용 multipart.
 * - 본 훅은 mutation 결과만 반환한다. 에러 코드별 토스트 매핑은 호출 측이 담당
 *   (UI 별로 메시지/리트라이 정책이 다를 수 있음).
 * - `signal` 을 넘겨주면 axios CancelToken 대신 AbortController 로 cancel 가능.
 *
 * Feature flag: `channelScheduleTemplate` (UI gate 가 sidebar/editor 에서 처리).
 */
export interface UseParsePsdVariables {
  file: File;
  signal?: AbortSignal;
}

export function useParsePsd(): UseMutationResult<
  ParsePsdResponse,
  Error,
  UseParsePsdVariables
> {
  return useMutation({
    mutationFn: ({ file, signal }) => parsePsd(file, { signal }),
  });
}
