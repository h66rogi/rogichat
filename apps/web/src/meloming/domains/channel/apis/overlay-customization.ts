import { apiClient } from "@/meloming/shared/lib/api-client";
import type {
  OverlayWidgetCssListResponse,
  OverlayWidgetCustomizationData,
  OverlayWidgetType,
  PutOverlayWidgetCssRequestBody,
} from "@/meloming/domains/channel/types/overlay-customization";

/**
 * 오버레이 위젯 커스텀 CSS 목록 조회
 * GET /channel/:identifier/overlay-customization/css
 * @returns 위젯별 커스터마이징 데이터와 권한 정보
 */
export async function getOverlayCustomizationList(
  identifier: string
): Promise<OverlayWidgetCssListResponse> {
  const response = await apiClient.get<OverlayWidgetCssListResponse>(
    `/channel/${identifier}/overlay-customization/css`,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * 오버레이 위젯 커스텀 CSS 저장/수정
 * PUT /channel/:identifier/overlay-customization/css/:widget
 */
export async function putOverlayWidgetCss(
  identifier: string,
  widget: OverlayWidgetType,
  body: PutOverlayWidgetCssRequestBody
): Promise<OverlayWidgetCustomizationData> {
  const response = await apiClient.put<OverlayWidgetCustomizationData>(
    `/channel/${identifier}/overlay-customization/css/${widget}`,
    body,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * 오버레이 위젯 커스텀 CSS 활성화/비활성화
 * PATCH /channel/:identifier/overlay-customization/css/:widget/enable
 */
export async function patchOverlayWidgetCssEnable(
  identifier: string,
  widget: OverlayWidgetType,
  isEnabled: boolean
): Promise<OverlayWidgetCustomizationData> {
  const response = await apiClient.patch<OverlayWidgetCustomizationData>(
    `/channel/${identifier}/overlay-customization/css/${widget}/enable`,
    { isEnabled },
    { withCredentials: true }
  );
  return response.data;
}

/**
 * 오버레이 위젯 커스텀 CSS 삭제
 * DELETE /channel/:identifier/overlay-customization/css/:widget
 */
export async function deleteOverlayWidgetCss(
  identifier: string,
  widget: OverlayWidgetType
): Promise<void> {
  await apiClient.delete(
    `/channel/${identifier}/overlay-customization/css/${widget}`,
    { withCredentials: true }
  );
}
