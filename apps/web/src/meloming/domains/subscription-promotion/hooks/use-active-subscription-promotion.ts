import { useQuery } from "@tanstack/react-query";
import { fetchActiveSubscriptionPromotion } from "@/meloming/domains/subscription-promotion/apis/subscription-promotion";

// Query keys
export const subscriptionPromotionKeys = {
  all: ["subscription-promotion"] as const,
  active: () => [...subscriptionPromotionKeys.all, "active"] as const,
};

/**
 * 활성 구독 프로모션 조회 Hook (10초 polling)
 */
export function useActiveSubscriptionPromotion({
  enabled = true,
}: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: subscriptionPromotionKeys.active(),
    queryFn: fetchActiveSubscriptionPromotion,
    enabled,
    refetchInterval: 10_000, // 10초 polling
    staleTime: 5_000, // 5초
  });
}
