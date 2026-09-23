import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { UseQueryResult, UseMutationResult } from "@tanstack/react-query";
import {
  getMyPlatformVerifications,
  revokePlatformVerification,
  verifyPlatform,
} from "@/meloming/domains/platform/apis/platform-verification";
import type {
  Platform,
  StreamPlatform,
} from "@/meloming/domains/platform/types/platform";
import type {
  GetMyPlatformVerificationsResponse,
  VerifyPlatformRequestDto,
  VerifyPlatformResponseDto,
} from "@/meloming/domains/platform/types/platform-verification";
import { toast } from "sonner";
import { extractApiErrorMessage } from "@/meloming/shared/lib/api-error";

function platformDisplayName(platform: StreamPlatform): string {
  return platform === "CHZZK"
    ? "치지직"
    : platform === "SOOP"
      ? "SOOP"
      : platform === "CIME"
        ? "씨미"
        : platform;
}

// Query keys
export const platformVerificationKeys = {
  all: ["platformVerification"] as const,
  me: () => [...platformVerificationKeys.all, "me"] as const,
};

/**
 * 내 플랫폼 인증 목록 조회 훅
 */
export function useMyPlatformVerifications(options?: {
  enabled?: boolean;
}): UseQueryResult<GetMyPlatformVerificationsResponse, Error> {
  return useQuery({
    queryKey: platformVerificationKeys.me(),
    queryFn: getMyPlatformVerifications,
    enabled: options?.enabled ?? true,
    staleTime: 5 * 60 * 1000, // 5분
    gcTime: 10 * 60 * 1000, // 10분
  });
}

/**
 * 플랫폼 인증 수행 뮤테이션 훅
 */
export function useVerifyPlatform(options?: {
  onSuccess?: (data: VerifyPlatformResponseDto) => void;
  onError?: (error: Error) => void;
}): UseMutationResult<
  VerifyPlatformResponseDto,
  Error,
  { platform: Platform; body: VerifyPlatformRequestDto }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ platform, body }) => verifyPlatform(platform, body),
    onSuccess: (data) => {
      // 플랫폼 인증 목록 캐시 무효화
      queryClient.invalidateQueries({
        queryKey: platformVerificationKeys.me(),
      });

      toast.success(`${platformDisplayName(data.platform)} 계정 연결이 완료되었습니다!`);
      options?.onSuccess?.(data);
    },
    onError: (error) => {
      console.error("플랫폼 인증 실패:", error);
      toast.error(
        extractApiErrorMessage(
          error,
          "플랫폼 인증에 실패했습니다. 다시 시도해주세요."
        )
      );
      options?.onError?.(error);
    },
  });
}

/**
 * 플랫폼 인증 해제 뮤테이션 훅
 */
export function useRevokePlatformVerification(options?: {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}): UseMutationResult<{ success: boolean }, Error, StreamPlatform> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (platform: StreamPlatform) =>
      revokePlatformVerification(platform),
    onSuccess: (_data, platform) => {
      queryClient.invalidateQueries({
        queryKey: platformVerificationKeys.me(),
      });
      toast.success(`${platformDisplayName(platform)} 계정 연결이 해제되었습니다.`);
      options?.onSuccess?.();
    },
    onError: (error) => {
      console.error("플랫폼 인증 해제 실패:", error);
      toast.error(
        extractApiErrorMessage(error, "플랫폼 인증 해제에 실패했습니다.")
      );
      options?.onError?.(error);
    },
  });
}
