import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { UseQueryResult, UseMutationResult } from "@tanstack/react-query";
import {
  getChannelVerificationPreview,
  getChannelVerifications,
  createChannelVerification,
  revokeChannelVerification,
} from "@/meloming/domains/channel/apis/channel-verification";
import type {
  ChannelVerificationPreviewDto,
  ChannelVerificationDto,
  CreateChannelVerificationDto,
} from "@/meloming/domains/channel/types/channel-verification";
import type { StreamPlatform } from "@/meloming/domains/platform/types/platform";
import { toast } from "sonner";
import { extractApiErrorMessage } from "@/meloming/shared/lib/api-error";

// Query keys
export const channelVerificationKeys = {
  all: ["channelVerification"] as const,
  preview: (identifier: string, platform?: StreamPlatform) =>
    [...channelVerificationKeys.all, "preview", identifier, platform] as const,
  verification: (identifier: string) =>
    [...channelVerificationKeys.all, "verification", identifier] as const,
};

/**
 * 채널 인증 미리보기 조회 훅
 */
export function useChannelVerificationPreview(
  identifier: string,
  options?: { enabled?: boolean; platform?: StreamPlatform }
): UseQueryResult<ChannelVerificationPreviewDto, Error> {
  return useQuery({
    queryKey: channelVerificationKeys.preview(identifier, options?.platform),
    queryFn: () => getChannelVerificationPreview(identifier, options?.platform),
    enabled: !!identifier && (options?.enabled ?? true),
    staleTime: 1 * 60 * 1000, // 1분
    gcTime: 5 * 60 * 1000, // 5분
  });
}

/**
 * 채널 인증 상태 조회 훅 (복수)
 */
export function useChannelVerifications(
  identifier: string,
  options?: { enabled?: boolean }
): UseQueryResult<ChannelVerificationDto[], Error> {
  return useQuery({
    queryKey: channelVerificationKeys.verification(identifier),
    queryFn: () => getChannelVerifications(identifier),
    enabled: !!identifier && (options?.enabled ?? true),
    staleTime: 1 * 60 * 1000, // 1분
    gcTime: 5 * 60 * 1000, // 5분
  });
}

/**
 * 채널 인증 신청 뮤테이션 훅
 */
export function useCreateChannelVerification(
  identifier: string,
  options?: {
    onSuccess?: (data: ChannelVerificationDto) => void;
    onError?: (error: Error) => void;
  }
): UseMutationResult<
  ChannelVerificationDto,
  Error,
  CreateChannelVerificationDto
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateChannelVerificationDto) =>
      createChannelVerification(identifier, body),
    onSuccess: (data) => {
      // 인증 상태 캐시 무효화 (all 키가 verification 키를 포함하므로 단일 호출로 충분)
      queryClient.invalidateQueries({
        queryKey: channelVerificationKeys.all,
      });

      if (data.status === "APPROVED") {
        toast.success("채널 인증이 완료되었습니다!");
      } else if (data.status === "PENDING") {
        toast.success("채널 인증 신청이 접수되었습니다. 검토 후 안내드리겠습니다.");
      }

      options?.onSuccess?.(data);
    },
    onError: (error) => {
      console.error("채널 인증 신청 실패:", error);
      toast.error(
        extractApiErrorMessage(
          error,
          "채널 인증 신청에 실패했습니다. 다시 시도해주세요."
        )
      );
      options?.onError?.(error);
    },
  });
}

/**
 * 채널 인증 해제 뮤테이션 훅
 */
export function useRevokeChannelVerification(
  identifier: string,
  options?: {
    onSuccess?: () => void;
    onError?: (error: Error) => void;
  }
): UseMutationResult<void, Error, StreamPlatform> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (platform: StreamPlatform) =>
      revokeChannelVerification(identifier, platform),
    onSuccess: () => {
      // 인증 상태 캐시 무효화 (all 키가 verification 키를 포함하므로 단일 호출로 충분)
      queryClient.invalidateQueries({
        queryKey: channelVerificationKeys.all,
      });

      toast.success("플랫폼 인증이 해제되었습니다.");
      options?.onSuccess?.();
    },
    onError: (error) => {
      console.error("채널 인증 해제 실패:", error);
      toast.error(
        extractApiErrorMessage(error, "인증 해제에 실패했습니다. 다시 시도해주세요.")
      );
      options?.onError?.(error);
    },
  });
}
