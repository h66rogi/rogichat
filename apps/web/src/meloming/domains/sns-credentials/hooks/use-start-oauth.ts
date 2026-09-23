import { useMutation } from "@tanstack/react-query";
import type { UseMutationResult } from "@tanstack/react-query";
import { toast } from "sonner";
import { startSnsOauth } from "@/meloming/domains/sns-credentials/apis/sns-credentials";
import type { OauthAuthorizeResponse } from "@/meloming/domains/sns-credentials/types/sns-credential";
import type { SnsPlatform } from "@/meloming/domains/sns-credentials/types/sns-platform";
import { extractApiErrorMessage } from "@/meloming/shared/lib/api-error";

interface UseStartOauthOptions {
  onSuccess?: (data: OauthAuthorizeResponse) => void;
  onError?: (error: Error) => void;
}

/**
 * SNS OAuth 시작 뮤테이션.
 *
 * 성공 시 기본 동작: `window.location.href = authorizeUrl` 로 이동.
 * onSuccess 옵션으로 override 가능.
 */
export function useStartOauth(
  options?: UseStartOauthOptions,
): UseMutationResult<OauthAuthorizeResponse, Error, SnsPlatform> {
  return useMutation({
    mutationFn: (platform: SnsPlatform) => startSnsOauth(platform),
    onSuccess: (data) => {
      if (options?.onSuccess) {
        options.onSuccess(data);
        return;
      }
      // SSR / 테스트 환경에서는 window 가 없을 수 있음
      if (typeof window !== "undefined") {
        window.location.href = data.authorizeUrl;
      }
    },
    onError: (error) => {
      console.error("SNS OAuth 시작 실패:", error);
      toast.error(
        extractApiErrorMessage(
          error,
          "SNS 연동을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        ),
      );
      options?.onError?.(error);
    },
  });
}
