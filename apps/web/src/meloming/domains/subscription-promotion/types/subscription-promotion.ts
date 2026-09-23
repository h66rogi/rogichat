/**
 * 프로모션 진행 상태
 */
export type PromotionStatus = "NOT_STARTED" | "ACTIVE" | "SOLD_OUT" | "ENDED";

/**
 * 프로모션에서 허용되는 결제 수단
 */
export type AllowedPromotionPaymentMethod =
  | "CARD"
  | "KAKAOPAY"
  | "NAVERPAY"
  | "TOSSPAY"
  | "BOOK_AND_LIFE"
  | "CULTURELAND";

/**
 * 프로모션 티어 정보
 */
export interface SubscriptionPromotionTier {
  tierOrder: number;
  accumulatedUpTo: number;
  price: number;
}

/**
 * 활성 구독 프로모션
 */
export interface ActiveSubscriptionPromotion {
  id: number;
  code: string;
  displayName: string;
  subscriptionItemId: number;
  status: PromotionStatus;
  startAt: string;
  endAt: string;
  totalCapacity: number;
  sold: number;
  reserved: number;
  currentTierOrder: number | null;
  currentPrice: number | null;
  /** 현재 티어의 남은 수량 (sold + reserved 기준) */
  remainingInCurrentTier: number;
  totalRemaining: number;
  allowedPaymentMethods: AllowedPromotionPaymentMethod[];
  tiers: SubscriptionPromotionTier[];
}

/**
 * 프로모션 관련 에러 코드
 */
export enum SubscriptionPromotionErrorCode {
  SOLD_OUT = "PROMO_SOLD_OUT",
  NOT_ACTIVE = "PROMO_NOT_ACTIVE",
  CAP_EXCEEDED = "PROMO_CAP_EXCEEDED",
  METHOD_NOT_ALLOWED = "PROMO_METHOD_NOT_ALLOWED",
  COUPON_NOT_ALLOWED = "PROMO_COUPON_NOT_ALLOWED",
  RECIPIENT_INVALID = "PROMO_RECIPIENT_INVALID",
  DISABLED = "PROMO_DISABLED",
}
