/**
 * 재화 키 → 화면 표시 단위 매핑.
 * 백엔드의 PLATFORM_EXCHANGE_TABLE과 일치해야 함.
 */
export const UNIT_BY_CURRENCY: Record<string, string> = {
  SOOP_BALLOON: '별풍선',
  CHZZK_CHEESE: '치즈',
  CIME_BEAM: '빔',
};

export interface FormatDonationAmountParams {
  nativeAmount?: number | null;
  currency?: string | null;
  krwSnapshot?: number | null;
}

/**
 * 후원 금액 표시 문자열 생성.
 *
 * 우선순위:
 * 1. native+currency 모두 있고 currency가 UNIT_BY_CURRENCY에 매핑되면: "{native} {단위}"
 *    예: {nativeAmount: 2, currency: 'SOOP_BALLOON'} → "2 별풍선"
 * 2. 그 외 krwSnapshot이 있으면 (legacy/KRW_LEGACY 포함): "{krw}원"
 *    예: {krwSnapshot: 5000} → "5,000원"
 * 3. 아무것도 없으면 빈 문자열
 *
 * 주의: currency가 알려지지 않은 값이면 (예: KRW_LEGACY, FOO_COIN) → krwSnapshot fallback
 */
export function formatDonationAmount(params: FormatDonationAmountParams): string {
  const { nativeAmount, currency, krwSnapshot } = params;

  if (
    nativeAmount != null &&
    currency != null &&
    typeof UNIT_BY_CURRENCY[currency] === 'string'
  ) {
    return `${nativeAmount.toLocaleString('ko-KR')} ${UNIT_BY_CURRENCY[currency]}`;
  }

  if (krwSnapshot != null) {
    return `${krwSnapshot.toLocaleString('ko-KR')}원`;
  }

  return '';
}
