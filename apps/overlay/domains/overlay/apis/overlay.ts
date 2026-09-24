import { apiClient } from "@/shared/lib/api-client";
import type { OverlayData } from "@/domains/overlay/types/overlay";

/**
 * GET /v1/overlay/:token
 * 오버레이 데이터를 가져옵니다.
 */
export async function getOverlayData(token: string): Promise<OverlayData> {
  const response = await apiClient.get<OverlayData>(`/overlay/${token}`);
  return response.data;
}
