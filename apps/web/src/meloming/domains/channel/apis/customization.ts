import { apiClient } from "@/meloming/shared/lib/api-client";
import type {
  ChannelCustomizationData,
  ChannelCustomizationResponse,
  PutCustomizationCssRequestBody,
  PatchCustomizationEnableRequestBody,
} from "@/meloming/domains/channel/types/customization";

/**
 * 커스텀 CSS 조회
 * GET /channel/:identifier/customization/css
 * @returns 커스터마이징 데이터와 권한 정보
 */
export async function getChannelCustomizationCss(
  identifier: string
): Promise<ChannelCustomizationResponse> {
  const response = await apiClient.get<ChannelCustomizationResponse>(
    `/channel/${identifier}/customization/css`,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * 커스텀 CSS 저장/수정
 * PUT /channel/:identifier/customization/css
 */
export async function putChannelCustomizationCss(
  identifier: string,
  body: PutCustomizationCssRequestBody
): Promise<ChannelCustomizationData> {
  const response = await apiClient.put<ChannelCustomizationData>(
    `/channel/${identifier}/customization/css`,
    body,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * 커스텀 CSS 활성화/비활성화
 * PATCH /channel/:identifier/customization/css/enable
 */
export async function patchChannelCustomizationEnable(
  identifier: string,
  body: PatchCustomizationEnableRequestBody
): Promise<ChannelCustomizationData> {
  const response = await apiClient.patch<ChannelCustomizationData>(
    `/channel/${identifier}/customization/css/enable`,
    body,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * 커스텀 CSS 삭제
 * DELETE /channel/:identifier/customization/css
 */
export async function deleteChannelCustomizationCss(
  identifier: string
): Promise<void> {
  await apiClient.delete(`/channel/${identifier}/customization/css`, {
    withCredentials: true,
  });
}
