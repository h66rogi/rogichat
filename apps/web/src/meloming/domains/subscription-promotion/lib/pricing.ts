/**
 * PRO 1년권 정가 기준 금액 (12,900원 × 12개월).
 * 프로모션 단계별 할인율/절약액 계산 기준값.
 */
export const PRO_ANNUAL_FULL_PRICE = 154_800;

/**
 * 프로모션 단가 대비 정가 기준 절약액과 할인율(%) 반환.
 *
 * @param price - 실제 결제 가격 (원)
 * @returns savingsAmount(원), discountPercent(%)
 */
export function calculateSavings(price: number): {
  savingsAmount: number;
  discountPercent: number;
} {
  const savingsAmount = PRO_ANNUAL_FULL_PRICE - price;
  const discountPercent = Math.round(
    (savingsAmount / PRO_ANNUAL_FULL_PRICE) * 100
  );
  return { savingsAmount, discountPercent };
}
