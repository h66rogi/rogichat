import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import {
  deleteOverlayWidgetCss,
  getOverlayCustomizationList,
  patchOverlayWidgetCssEnable,
  putOverlayWidgetCss,
} from "@/meloming/domains/channel/apis/overlay-customization";
import type {
  OverlayWidgetCssListResponse,
  OverlayWidgetCustomizationData,
  OverlayWidgetType,
  PutOverlayWidgetCssRequestBody,
} from "@/meloming/domains/channel/types/overlay-customization";

// Query keys
export const overlayCustomizationKeys = {
  all: ["overlay-customization"] as const,
  list: (identifier: string) =>
    [...overlayCustomizationKeys.all, "list", identifier] as const,
};

type UseOverlayCustomizationOptions = {
  enabled?: boolean;
  staleTime?: number;
  gcTime?: number;
};

/**
 * 채널 오버레이 위젯 커스텀 CSS 목록 조회 훅
 * @returns 위젯별 customization 데이터와 권한 정보 (isOwner, isOwnerPro, canSave)
 */
export function useOverlayCustomizationList(
  identifier: string,
  options?: UseOverlayCustomizationOptions
): UseQueryResult<OverlayWidgetCssListResponse, Error> {
  return useQuery({
    queryKey: overlayCustomizationKeys.list(identifier),
    queryFn: () => getOverlayCustomizationList(identifier),
    enabled: !!identifier && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 5 * 60 * 1000, // 5분
    gcTime: options?.gcTime ?? 10 * 60 * 1000, // 10분
  });
}

/**
 * 채널 오버레이 위젯 커스텀 CSS 관리 훅 (저장, 토글, 삭제)
 */
export function useOverlayCustomizationMutations(identifier: string): {
  saveCss: UseMutationResult<
    OverlayWidgetCustomizationData,
    Error,
    { widget: OverlayWidgetType; body: PutOverlayWidgetCssRequestBody },
    unknown
  >;
  toggleEnabled: UseMutationResult<
    OverlayWidgetCustomizationData,
    Error,
    { widget: OverlayWidgetType; isEnabled: boolean },
    unknown
  >;
  deleteCss: UseMutationResult<void, Error, OverlayWidgetType, unknown>;
} {
  const queryClient = useQueryClient();

  const invalidateQueries = () => {
    queryClient.invalidateQueries({
      queryKey: overlayCustomizationKeys.list(identifier),
    });
  };

  const saveCss = useMutation({
    mutationFn: (args: {
      widget: OverlayWidgetType;
      body: PutOverlayWidgetCssRequestBody;
    }) => putOverlayWidgetCss(identifier, args.widget, args.body),
    onSuccess: () => invalidateQueries(),
  });

  const toggleEnabled = useMutation({
    mutationFn: (args: { widget: OverlayWidgetType; isEnabled: boolean }) =>
      patchOverlayWidgetCssEnable(identifier, args.widget, args.isEnabled),
    onSuccess: () => invalidateQueries(),
  });

  const deleteCss = useMutation({
    mutationFn: (widget: OverlayWidgetType) =>
      deleteOverlayWidgetCss(identifier, widget),
    onSuccess: () => invalidateQueries(),
  });

  return { saveCss, toggleEnabled, deleteCss };
}
