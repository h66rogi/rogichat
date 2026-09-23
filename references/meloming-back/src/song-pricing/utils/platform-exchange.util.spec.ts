import {
  ExchangeRateEntry,
  PLATFORM_EXCHANGE_TABLE,
  UnknownCurrencyError,
  compareAmounts,
  lookupExchangeRate,
  nativeToKrw,
  pickEffective,
} from './platform-exchange.util';

describe('platform-exchange.util', () => {
  describe('PLATFORM_EXCHANGE_TABLE', () => {
    it('테이블에 정확히 4개의 항목이 있어야 한다', () => {
      expect(PLATFORM_EXCHANGE_TABLE).toHaveLength(4);
    });

    it('SOOP_BALLOON 항목이 존재해야 한다', () => {
      const entry = PLATFORM_EXCHANGE_TABLE.find(
        (e) => e.currencyKey === 'SOOP_BALLOON',
      );
      expect(entry).toBeDefined();
      expect(entry!.krwPerUnit).toBe(100);
    });
  });

  describe('lookupExchangeRate', () => {
    it('SOOP_BALLOON 조회 시 krwPerUnit이 100인 항목을 반환해야 한다', () => {
      const entry = lookupExchangeRate('SOOP_BALLOON');
      expect(entry.krwPerUnit).toBe(100);
    });

    it('CHZZK_CHEESE 조회 시 krwPerUnit이 1인 항목을 반환해야 한다', () => {
      const entry = lookupExchangeRate('CHZZK_CHEESE');
      expect(entry.krwPerUnit).toBe(1);
    });

    it('CIME_BEAM 조회 시 krwPerUnit이 1인 항목을 반환해야 한다', () => {
      const entry = lookupExchangeRate('CIME_BEAM');
      expect(entry.krwPerUnit).toBe(1);
    });

    it('KRW_LEGACY 조회 시 krwPerUnit이 1인 항목을 반환해야 한다', () => {
      const entry = lookupExchangeRate('KRW_LEGACY');
      expect(entry.krwPerUnit).toBe(1);
    });

    it('알 수 없는 통화키 조회 시 UnknownCurrencyError를 던져야 한다', () => {
      expect(() => lookupExchangeRate('UNKNOWN_XYZ')).toThrow(
        UnknownCurrencyError,
      );
    });

    it('알 수 없는 통화키 에러 메시지에 해당 키가 포함되어야 한다', () => {
      expect(() => lookupExchangeRate('UNKNOWN_XYZ')).toThrow(
        'Unknown currencyKey: UNKNOWN_XYZ',
      );
    });

    it('at 파라미터가 effectiveFrom보다 이전이면 해당 항목을 반환하지 않는다', () => {
      const futureTable: ExchangeRateEntry[] = [
        {
          currencyKey: 'TEST_COIN',
          krwPerUnit: 50,
          effectiveFrom: '2020-01-01T00:00:00Z',
          source: 'test',
          version: 1,
        },
        {
          currencyKey: 'TEST_COIN',
          krwPerUnit: 100,
          effectiveFrom: '2030-01-01T00:00:00Z',
          source: 'test',
          version: 2,
        },
      ];

      // at = 2025-01-01이면 version 1(50)만 유효해야 한다
      const at = new Date('2025-01-01T00:00:00Z');
      const best = pickEffective(futureTable, 'TEST_COIN', at);
      expect(best).toBeDefined();
      expect(best!.krwPerUnit).toBe(50);

      // at = 2031-01-01이면 version 2(100)가 우선이어야 한다
      const atFuture = new Date('2031-01-01T00:00:00Z');
      const bestFuture = pickEffective(futureTable, 'TEST_COIN', atFuture);
      expect(bestFuture).toBeDefined();
      expect(bestFuture!.krwPerUnit).toBe(100);
    });

    it('effectiveFrom이 동일하면 version이 높은 항목을 반환해야 한다', () => {
      const tieTable: ExchangeRateEntry[] = [
        {
          currencyKey: 'TEST_COIN',
          krwPerUnit: 50,
          effectiveFrom: '2020-01-01T00:00:00Z',
          source: 'test',
          version: 1,
        },
        {
          currencyKey: 'TEST_COIN',
          krwPerUnit: 75,
          effectiveFrom: '2020-01-01T00:00:00Z',
          source: 'test',
          version: 2,
        },
      ];

      const at = new Date('2025-01-01T00:00:00Z');
      const result = pickEffective(tieTable, 'TEST_COIN', at);
      expect(result).toBeDefined();
      // version 2 (krwPerUnit: 75)가 선택되어야 한다
      expect(result!.version).toBe(2);
      expect(result!.krwPerUnit).toBe(75);
    });
  });

  describe('nativeToKrw', () => {
    it('2 SOOP_BALLOON은 200 KRW이어야 한다', () => {
      expect(nativeToKrw(2, 'SOOP_BALLOON')).toBe(200);
    });

    it('100 CHZZK_CHEESE는 100 KRW이어야 한다', () => {
      expect(nativeToKrw(100, 'CHZZK_CHEESE')).toBe(100);
    });

    it('알 수 없는 통화키 사용 시 UnknownCurrencyError를 던져야 한다', () => {
      expect(() => nativeToKrw(100, 'INVALID_KEY')).toThrow(
        UnknownCurrencyError,
      );
    });
  });

  describe('compareAmounts', () => {
    it('같은 통화키: amount가 작으면 -1을 반환해야 한다', () => {
      expect(
        compareAmounts(
          { amount: 1, currencyKey: 'SOOP_BALLOON' },
          { amount: 2, currencyKey: 'SOOP_BALLOON' },
        ),
      ).toBe(-1);
    });

    it('같은 통화키: amount가 같으면 0을 반환해야 한다', () => {
      expect(
        compareAmounts(
          { amount: 5, currencyKey: 'CHZZK_CHEESE' },
          { amount: 5, currencyKey: 'CHZZK_CHEESE' },
        ),
      ).toBe(0);
    });

    it('같은 통화키: amount가 크면 1을 반환해야 한다', () => {
      expect(
        compareAmounts(
          { amount: 10, currencyKey: 'SOOP_BALLOON' },
          { amount: 3, currencyKey: 'SOOP_BALLOON' },
        ),
      ).toBe(1);
    });

    it('다른 통화키: 200 KRW_LEGACY == 2 SOOP_BALLOON (둘 다 200 KRW)이므로 0을 반환해야 한다', () => {
      expect(
        compareAmounts(
          { amount: 200, currencyKey: 'KRW_LEGACY' },
          { amount: 2, currencyKey: 'SOOP_BALLOON' },
        ),
      ).toBe(0);
    });

    it('다른 통화키: 1 SOOP_BALLOON(100 KRW) < 200 CHZZK_CHEESE(200 KRW)이므로 -1을 반환해야 한다', () => {
      expect(
        compareAmounts(
          { amount: 1, currencyKey: 'SOOP_BALLOON' },
          { amount: 200, currencyKey: 'CHZZK_CHEESE' },
        ),
      ).toBe(-1);
    });

    it('다른 통화키: 3 SOOP_BALLOON(300 KRW) > 100 CHZZK_CHEESE(100 KRW)이므로 1을 반환해야 한다', () => {
      expect(
        compareAmounts(
          { amount: 3, currencyKey: 'SOOP_BALLOON' },
          { amount: 100, currencyKey: 'CHZZK_CHEESE' },
        ),
      ).toBe(1);
    });
  });
});
