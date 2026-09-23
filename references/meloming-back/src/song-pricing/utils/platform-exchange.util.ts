/**
 * 플랫폼 재화 환율 테이블
 *
 * 각 플랫폼 고유 재화(별풍선, 치즈, 빔 등)와 KRW 간 환율을 정의합니다.
 * 향후 환율 변경 이력을 지원하기 위해 effectiveFrom 필드로 유효 시작 시각을 관리합니다.
 */

export interface ExchangeRateEntry {
  /** 재화 키 (예: 'SOOP_BALLOON', 'CHZZK_CHEESE') */
  currencyKey: string;
  /** 재화 1단위당 KRW 환산 금액 */
  krwPerUnit: number;
  /** 이 환율이 유효해지는 시각 (ISO8601) */
  effectiveFrom: string;
  /** 환율 출처 */
  source: string;
  /** 환율 버전 (동일 통화키 내에서 변경 이력 추적용) */
  version: number;
}

/**
 * 플랫폼 공식 재화 환율 테이블 (프로덕션 용)
 *
 * 새 환율이 필요하면 기존 항목을 수정하지 말고 새 항목을 추가하세요.
 * lookupExchangeRate는 at 시각 이전에서 가장 최신 effectiveFrom을 선택합니다.
 */
export const PLATFORM_EXCHANGE_TABLE: readonly ExchangeRateEntry[] = [
  {
    currencyKey: 'SOOP_BALLOON',
    krwPerUnit: 100,
    effectiveFrom: '2026-01-01T00:00:00Z',
    source: 'platform-official',
    version: 1,
  },
  {
    currencyKey: 'CHZZK_CHEESE',
    krwPerUnit: 1,
    effectiveFrom: '2026-01-01T00:00:00Z',
    source: 'platform-official',
    version: 1,
  },
  {
    currencyKey: 'CIME_BEAM',
    krwPerUnit: 1,
    effectiveFrom: '2026-01-01T00:00:00Z',
    source: 'platform-official',
    version: 1,
  },
  {
    currencyKey: 'KRW_LEGACY',
    krwPerUnit: 1,
    effectiveFrom: '2000-01-01T00:00:00Z',
    source: 'legacy',
    version: 1,
  },
] as const;

/**
 * 알 수 없는 재화 키 오류
 */
export class UnknownCurrencyError extends Error {
  constructor(currencyKey: string) {
    super(`Unknown currencyKey: ${currencyKey}`);
    this.name = 'UnknownCurrencyError';
  }
}

/**
 * 주어진 entries 중 특정 시각 기준으로 currencyKey에 해당하는 최신 항목을 반환합니다.
 *
 * effectiveFrom이 동일한 경우 version이 높은 항목을 선택합니다.
 * 유효한 항목이 없으면 undefined를 반환합니다.
 *
 * @internal 테스트 가능성을 위해 export되어 있으나 프로덕션에서는 lookupExchangeRate를 사용하세요.
 */
export function pickEffective(
  entries: readonly ExchangeRateEntry[],
  currencyKey: string,
  at: Date,
): ExchangeRateEntry | undefined {
  const eligible = entries.filter(
    (entry) =>
      entry.currencyKey === currencyKey && new Date(entry.effectiveFrom) <= at,
  );

  if (eligible.length === 0) {
    return undefined;
  }

  // effectiveFrom이 최신인 항목 선택, 동점 시 version이 높은 항목 선택
  return eligible.reduce((best, current) => {
    const currentMs = new Date(current.effectiveFrom).getTime();
    const bestMs = new Date(best.effectiveFrom).getTime();
    if (
      currentMs > bestMs ||
      (currentMs === bestMs && current.version > best.version)
    ) {
      return current;
    }
    return best;
  });
}

/**
 * 특정 시각 기준으로 재화 환율 항목을 조회합니다.
 *
 * @param currencyKey - 재화 키
 * @param at - 조회 기준 시각 (기본값: 현재 시각)
 * @returns 유효한 환율 항목 (여러 항목이 있으면 가장 최신 effectiveFrom 우선, 동점 시 version 우선)
 * @throws UnknownCurrencyError - 해당 시각에 유효한 항목이 없을 때
 */
export function lookupExchangeRate(
  currencyKey: string,
  at: Date = new Date(),
): ExchangeRateEntry {
  const result = pickEffective(PLATFORM_EXCHANGE_TABLE, currencyKey, at);

  if (result === undefined) {
    throw new UnknownCurrencyError(currencyKey);
  }

  return result;
}

/**
 * 재화 금액을 KRW로 환산합니다.
 *
 * @param amount - 재화 수량
 * @param currencyKey - 재화 키
 * @param at - 조회 기준 시각 (기본값: 현재 시각)
 * @returns KRW 환산 금액
 * @throws UnknownCurrencyError - 알 수 없는 재화 키
 */
export function nativeToKrw(
  amount: number,
  currencyKey: string,
  at?: Date,
): number {
  return amount * lookupExchangeRate(currencyKey, at).krwPerUnit;
}

/**
 * 두 재화 금액을 비교합니다.
 *
 * 같은 재화키이면 수량을 직접 비교하고,
 * 다른 재화키이면 KRW로 환산하여 비교합니다.
 *
 * @returns a < b이면 -1, a === b이면 0, a > b이면 1
 * @throws UnknownCurrencyError - 알 수 없는 재화 키
 */
export function compareAmounts(
  a: { amount: number; currencyKey: string },
  b: { amount: number; currencyKey: string },
  at?: Date,
): -1 | 0 | 1 {
  const aKrw =
    a.currencyKey === b.currencyKey
      ? a.amount
      : nativeToKrw(a.amount, a.currencyKey, at);
  const bKrw =
    a.currencyKey === b.currencyKey
      ? b.amount
      : nativeToKrw(b.amount, b.currencyKey, at);

  if (aKrw < bKrw) return -1;
  if (aKrw > bKrw) return 1;
  return 0;
}
