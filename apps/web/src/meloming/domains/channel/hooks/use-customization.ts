import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import {
  getChannelCustomizationCss,
  putChannelCustomizationCss,
  patchChannelCustomizationEnable,
  deleteChannelCustomizationCss,
} from "@/meloming/domains/channel/apis/customization";
import type {
  ChannelCustomizationData,
  ChannelCustomizationResponse,
  PutCustomizationCssRequestBody,
} from "@/meloming/domains/channel/types/customization";
import { channelKeys } from "./use-channel";

// Query keys
export const customizationKeys = {
  all: ["customization"] as const,
  css: (identifier: string) =>
    [...customizationKeys.all, "css", identifier] as const,
};

type UseCustomizationOptions = {
  enabled?: boolean;
  staleTime?: number;
  cacheTime?: number;
};

/**
 * 채널 커스텀 CSS 조회 훅
 * @returns customization 데이터와 권한 정보 (isOwner, isOwnerPro, canSave)
 */
export function useChannelCustomization(
  identifier: string,
  options?: UseCustomizationOptions
): UseQueryResult<ChannelCustomizationResponse, Error> {
  return useQuery({
    queryKey: customizationKeys.css(identifier),
    queryFn: () => getChannelCustomizationCss(identifier),
    enabled: !!identifier && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 5 * 60 * 1000, // 5분
    gcTime: options?.cacheTime ?? 10 * 60 * 1000, // 10분
  });
}

/**
 * 채널 커스텀 CSS 관리 훅 (저장, 토글, 삭제)
 */
export function useCustomizationMutations(identifier: string): {
  saveCss: UseMutationResult<
    ChannelCustomizationData,
    Error,
    PutCustomizationCssRequestBody,
    unknown
  >;
  toggleEnabled: UseMutationResult<
    ChannelCustomizationData,
    Error,
    boolean,
    unknown
  >;
  deleteCss: UseMutationResult<void, Error, void, unknown>;
} {
  const queryClient = useQueryClient();

  const invalidateQueries = () => {
    // 커스터마이징 쿼리 무효화
    queryClient.invalidateQueries({
      queryKey: customizationKeys.css(identifier),
    });
    // 채널 정보도 무효화 (customCss 포함)
    queryClient.invalidateQueries({
      queryKey: channelKeys.identifier(identifier),
    });
  };

  const saveCss = useMutation({
    mutationFn: (body: PutCustomizationCssRequestBody) =>
      putChannelCustomizationCss(identifier, body),
    onSuccess: () => invalidateQueries(),
  });

  const toggleEnabled = useMutation({
    mutationFn: (isEnabled: boolean) =>
      patchChannelCustomizationEnable(identifier, { isEnabled }),
    onSuccess: () => invalidateQueries(),
  });

  const deleteCss = useMutation({
    mutationFn: () => deleteChannelCustomizationCss(identifier),
    onSuccess: () => invalidateQueries(),
  });

  return { saveCss, toggleEnabled, deleteCss };
}

