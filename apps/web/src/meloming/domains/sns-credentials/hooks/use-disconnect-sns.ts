import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { UseMutationResult } from "@tanstack/react-query";
import { toast } from "sonner";
import { disconnectSns } from "@/meloming/domains/sns-credentials/apis/sns-credentials";
import type { SnsPlatform } from "@/meloming/domains/sns-credentials/types/sns-platform";
import { snsCredentialsKeys } from "@/meloming/domains/sns-credentials/query-keys";
import { extractApiErrorMessage } from "@/meloming/shared/lib/api-error";

interface UseDisconnectSnsOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

/**
 * SNS 연동 해제 뮤테이션.
 *
 * 성공 시 sns-credentials 캐시를 invalidate 하여 카드 상태 즉시 갱신.
 */
export function useDisconnectSns(
  options?: UseDisconnectSnsOptions,
): UseMutationResult<void, Error, SnsPlatform> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (platform: SnsPlatform) => disconnectSns(platform),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: snsCredentialsKeys.all,
      });
      toast.success("연동이 해제되었습니다.");
      options?.onSuccess?.();
    },
    onError: (error) => {
      console.error("SNS 연동 해제 실패:", error);
      toast.error(
        extractApiErrorMessage(
          error,
          "연동 해제에 실패했습니다. 잠시 후 다시 시도해 주세요.",
        ),
      );
      options?.onError?.(error);
    },
  });
}
