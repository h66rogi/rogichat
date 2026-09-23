import { apiClient } from "@/meloming/shared/lib/api-client";
import type {
  GetPricingSettingsResponse,
  UpdatePricingSettingsDto,
  UpdatePricingSettingsResponse,
  UpdateSongPriceDto,
  UpdateSongPriceResponse,
  UpdateCategoryPriceDto,
  UpdateCategoryPriceResponse,
  CalculatePricesDto,
  CalculatePricesResponse,
  GetSongPriceResponse,
} from "@/meloming/domains/channel/types/pricing";

/**
 * GET /channels/:channelId/pricing-settings
 * 채널의 가격 설정을 조회합니다.
 */
export async function getPricingSettings(
  channelId: number
): Promise<GetPricingSettingsResponse> {
  const response = await apiClient.get<GetPricingSettingsResponse>(
    `/channels/${channelId}/pricing-settings`
  );
  return response.data;
}

/**
 * PUT /channels/:channelId/pricing-settings
 * 채널의 가격 설정을 업데이트합니다.
 */
export async function updatePricingSettings(
  channelId: number,
  dto: UpdatePricingSettingsDto
): Promise<UpdatePricingSettingsResponse> {
  const response = await apiClient.put<UpdatePricingSettingsResponse>(
    `/channels/${channelId}/pricing-settings`,
    dto,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * PATCH /channels/:channelId/songs/:songId/price
 * 곡의 가격을 업데이트합니다.
 */
export async function updateSongPrice(
  channelId: number,
  songId: number,
  dto: UpdateSongPriceDto
): Promise<UpdateSongPriceResponse> {
  const response = await apiClient.patch<UpdateSongPriceResponse>(
    `/channels/${channelId}/songs/${songId}/price`,
    dto,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * PATCH /channels/:channelId/categories/:categoryId/price
 * 카테고리의 가격을 업데이트합니다.
 */
export async function updateCategoryPrice(
  channelId: number,
  categoryId: number,
  dto: UpdateCategoryPriceDto
): Promise<UpdateCategoryPriceResponse> {
  const response = await apiClient.patch<UpdateCategoryPriceResponse>(
    `/channels/${channelId}/categories/${categoryId}/price`,
    dto,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * GET /channels/:channelId/songs/:songId/price
 * 곡의 계산된 가격을 조회합니다.
 */
export async function getSongPrice(
  channelId: number,
  songId: number
): Promise<GetSongPriceResponse> {
  const response = await apiClient.get<GetSongPriceResponse>(
    `/channels/${channelId}/songs/${songId}/price`
  );
  return response.data;
}

/**
 * POST /channels/:channelId/songs/calculate-prices
 * 여러 곡의 가격을 한 번에 계산합니다.
 */
export async function calculatePrices(
  channelId: number,
  dto: CalculatePricesDto
): Promise<CalculatePricesResponse> {
  const response = await apiClient.post<CalculatePricesResponse>(
    `/channels/${channelId}/songs/calculate-prices`,
    dto
  );
  return response.data;
}
