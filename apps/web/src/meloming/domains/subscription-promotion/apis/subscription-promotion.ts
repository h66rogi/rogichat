import { apiClient } from "@/meloming/shared/lib/api-client";
import type { ActiveSubscriptionPromotion } from "@/meloming/domains/subscription-promotion/types/subscription-promotion";

/**
 * 현재 활성 구독 프로모션 조회
 * 활성 프로모션이 없으면 null 반환
 */
export async function fetchActiveSubscriptionPromotion(): Promise<ActiveSubscriptionPromotion | null> {
  const response = await apiClient.get<ActiveSubscriptionPromotion | null>(
    "/subscription-promotions/active"
  );
  return response.data ?? null;
}
