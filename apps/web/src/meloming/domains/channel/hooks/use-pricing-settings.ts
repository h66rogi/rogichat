import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getPricingSettings,
  updatePricingSettings,
  updateSongPrice,
  updateCategoryPrice,
  getSongPrice,
  calculatePrices,
} from "@/meloming/domains/channel/apis/pricing";
import type {
  PricingSettings,
  UpdatePricingSettingsDto,
  UpdateSongPriceDto,
  UpdateCategoryPriceDto,
  CalculatePricesDto,
} from "@/meloming/domains/channel/types/pricing";

/**
 * 가격 설정이 실제로 사용할 만한 수준으로 구성됐는지 판단.
 * - pricingEnabled가 꺼져 있으면 false
 * - 재화가 하나도 없으면 false
 * - 모든 재화의 기본 가격과 난이도 가격이 모두 null/0이면 false
 * (개별 곡/카테고리 가격은 여기서 확인하지 않음 — 이 훅은 후원 전용 등 채널 단위 옵션 검증용)
 */
export function hasUsablePriceConfig(
  pricing: Pick<
    PricingSettings,
    | "pricingEnabled"
    | "defaultPrice"
    | "defaultPrices"
    | "difficultyPrices"
    | "difficultyPricesByCurrency"
    | "currencyConfigs"
  > | null | undefined
): boolean {
  if (!pricing || !pricing.pricingEnabled) return false;

  const hasAmount = (value: number | null | undefined) =>
    typeof value === "number" && Number.isFinite(value) && value > 0;

  if (hasAmount(pricing.defaultPrice)) return true;

  const defaultPrices = pricing.defaultPrices ?? {};
  if (Object.values(defaultPrices).some(hasAmount)) return true;

  const legacyDifficulty = pricing.difficultyPrices ?? {};
  if (Object.values(legacyDifficulty).some(hasAmount)) return true;

  const difficultyByCurrency = pricing.difficultyPricesByCurrency ?? {};
  for (const levels of Object.values(difficultyByCurrency)) {
    if (!levels) continue;
    if (Object.values(levels).some(hasAmount)) return true;
  }

  return false;
}

// Query Keys
export const pricingKeys = {
  all: ["pricing"] as const,
  settings: (channelId: number) => [...pricingKeys.all, "settings", channelId] as const,
  songPrice: (channelId: number, songId: number) =>
    [...pricingKeys.all, "song", channelId, songId] as const,
  bulkPrices: (channelId: number) => [...pricingKeys.all, "bulk", channelId] as const,
};

/**
 * 채널 가격 설정 조회 훅
 */
export function usePricingSettings(channelId: number | undefined) {
  return useQuery({
    queryKey: pricingKeys.settings(channelId!),
    queryFn: () => getPricingSettings(channelId!),
    enabled: !!channelId,
  });
}

/**
 * 채널 가격 설정 업데이트 훅
 */
export function useUpdatePricingSettings(channelId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: UpdatePricingSettingsDto) =>
      updatePricingSettings(channelId, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pricingKeys.settings(channelId) });
    },
  });
}

/**
 * 곡 가격 업데이트 훅
 */
export function useUpdateSongPrice(channelId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ songId, dto }: { songId: number; dto: UpdateSongPriceDto }) =>
      updateSongPrice(channelId, songId, dto),
    onSuccess: (_, { songId }) => {
      queryClient.invalidateQueries({ queryKey: pricingKeys.songPrice(channelId, songId) });
      queryClient.invalidateQueries({ queryKey: pricingKeys.bulkPrices(channelId) });
    },
  });
}

/**
 * 카테고리 가격 업데이트 훅
 */
export function useUpdateCategoryPrice(channelId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      categoryId,
      dto,
    }: {
      categoryId: number;
      dto: UpdateCategoryPriceDto;
    }) => updateCategoryPrice(channelId, categoryId, dto),
    onSuccess: () => {
      // 카테고리 가격 변경 시 모든 곡 가격에 영향을 줄 수 있음
      queryClient.invalidateQueries({ queryKey: pricingKeys.all });
    },
  });
}

/**
 * 단일 곡 가격 조회 훅
 */
export function useSongPrice(
  channelId: number | undefined,
  songId: number | undefined
) {
  return useQuery({
    queryKey: pricingKeys.songPrice(channelId!, songId!),
    queryFn: () => getSongPrice(channelId!, songId!),
    enabled: !!channelId && !!songId,
  });
}

/**
 * 여러 곡 가격 일괄 계산 훅
 */
export function useCalculatePrices(channelId: number) {
  return useMutation({
    mutationFn: (dto: CalculatePricesDto) => calculatePrices(channelId, dto),
  });
}
