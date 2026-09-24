import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getOverlayLayout,
  updateOverlayLayout,
  type OverlayLayoutResponse,
} from "@/meloming/domains/channel/apis/overlay-layouts";
import type { TotalOverlayLayout } from "@/meloming/domains/overlay/constants/total-layout";
import type { AxiosError } from "axios";

const overlayLayoutKeys = {
  all: (identifier: string) => ["overlay-layouts", identifier] as const,
  detail: (identifier: string, layoutType: string) =>
    [...overlayLayoutKeys.all(identifier), layoutType] as const,
};

function shouldRetryAuthError(failureCount: number, error: unknown): boolean {
  const status = (error as AxiosError | undefined)?.response?.status;
  if (status === 401 || status === 403) {
    return false;
  }
  return failureCount < 2;
}

export function useOverlayLayout(
  identifier: string,
  layoutType: string = "total",
  enabled = true
) {
  return useQuery({
    queryKey: overlayLayoutKeys.detail(identifier, layoutType),
    queryFn: () => getOverlayLayout(identifier, layoutType),
    enabled: Boolean(identifier) && enabled,
    staleTime: 1000 * 60 * 5,
    retry: shouldRetryAuthError,
  });
}

export function useUpdateOverlayLayout(
  identifier: string,
  layoutType: string = "total"
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (layout: TotalOverlayLayout) =>
      updateOverlayLayout(identifier, layoutType, layout),
    onSuccess: (data: OverlayLayoutResponse) => {
      queryClient.setQueryData(
        overlayLayoutKeys.detail(identifier, layoutType),
        data
      );
    },
  });
}
