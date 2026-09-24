import { apiClient } from "@/meloming/shared/lib/api-client";
import type { TotalOverlayLayout } from "@/meloming/domains/overlay/constants/total-layout";

export interface OverlayLayoutResponse {
  layoutType: string;
  layout: TotalOverlayLayout;
  layoutVersion: number;
  layoutUpdatedAt: string | null;
}

/**
 * 채널의 통합 오버레이 레이아웃 조회
 */
export async function getOverlayLayout(
  identifier: string,
  layoutType: string = "total"
): Promise<OverlayLayoutResponse> {
  const response = await apiClient.get<OverlayLayoutResponse>(
    `/channel/${identifier}/overlay-layouts/${layoutType}`,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * 채널의 통합 오버레이 레이아웃 업데이트
 */
export async function updateOverlayLayout(
  identifier: string,
  layoutType: string,
  layout: TotalOverlayLayout
): Promise<OverlayLayoutResponse> {
  const response = await apiClient.put<OverlayLayoutResponse>(
    `/channel/${identifier}/overlay-layouts/${layoutType}`,
    { layout },
    { withCredentials: true }
  );
  return response.data;
}
