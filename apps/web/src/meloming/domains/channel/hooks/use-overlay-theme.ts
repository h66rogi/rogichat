import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import {
  getThemeCatalog,
  getThemeDetail,
  getUnifiedThemeConfig,
  orderThemeCatalogForDisplay,
  updateUnifiedThemeConfig,
  type UnifiedThemeConfig,
  type UpdateThemeConfigBody,
} from "@/meloming/domains/channel/apis/overlay-theme";

// Query Keys
export const overlayThemeKeys = {
  all: ["overlay-theme"] as const,
  byChannel: (identifier: string) =>
    [...overlayThemeKeys.all, "channel", identifier] as const,
  catalog: () => [...overlayThemeKeys.all, "catalog"] as const,
  catalogDetail: (themeId: string) =>
    [...overlayThemeKeys.all, "catalog", themeId] as const,
};

function shouldRetryAuthError(failureCount: number, error: unknown): boolean {
  const status = (error as AxiosError | undefined)?.response?.status;
  if (status === 401 || status === 403) {
    return false;
  }
  return failureCount < 2;
}

/**
 * 채널의 통합 테마 설정 조회 훅 (Phase 3 unified).
 * 저장된 값이 없으면 백엔드가 lazy-create하여 기본값 반환.
 */
export function useUnifiedThemeConfig(identifier: string, enabled = true) {
  return useQuery({
    queryKey: overlayThemeKeys.byChannel(identifier),
    queryFn: () => getUnifiedThemeConfig(identifier),
    enabled: Boolean(identifier) && enabled,
    staleTime: 1000 * 60 * 2, // 2 minutes
    retry: shouldRetryAuthError,
  });
}

/**
 * 채널의 통합 테마 설정 배치 업데이트 뮤테이션 훅 (Phase 3 unified).
 */
export function useUpdateUnifiedThemeConfig(identifier: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: UpdateThemeConfigBody) =>
      updateUnifiedThemeConfig(identifier, body),
    onSuccess: (data: UnifiedThemeConfig) => {
      queryClient.setQueryData(overlayThemeKeys.byChannel(identifier), data);
    },
  });
}

/**
 * 12개 테마 카탈로그 목록 조회 훅.
 *
 * staleTime 30분: 카탈로그 자체는 자주 변하지 않지만 Infinity로 두면 백엔드
 * catalog 수정을 사용자 세션이 절대 반영 못 하는 문제가 있어 적절한 상한을
 * 둔다. 30분이면 하루 작업 세션 중 한 번은 자연 리프레시됨.
 */
export function useThemeCatalog() {
  return useQuery({
    queryKey: overlayThemeKeys.catalog(),
    queryFn: () => getThemeCatalog(),
    // 표시 순서 조정(concert-poster를 spotify와 billboard 사이로)을 select에서
    // 적용해 모든 테마 선택 그리드가 동일한 순서를 공유하도록 한다.
    select: (data) => ({
      ...data,
      themes: orderThemeCatalogForDisplay(data.themes),
    }),
    staleTime: 30 * 60 * 1000,
    retry: shouldRetryAuthError,
  });
}

/**
 * 단일 테마 카탈로그 항목 조회 훅.
 * `themeId`가 null이면 쿼리를 비활성화한다.
 */
export function useThemeDetail(themeId: string | null) {
  return useQuery({
    queryKey: overlayThemeKeys.catalogDetail(themeId ?? ""),
    queryFn: () => {
      if (!themeId) {
        return Promise.reject(new Error("themeId is required"));
      }
      return getThemeDetail(themeId);
    },
    enabled: Boolean(themeId),
    staleTime: 30 * 60 * 1000,
    retry: shouldRetryAuthError,
  });
}
