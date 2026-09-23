import { StreamPlatform } from '@prisma/client';
import {
  CURRENCY_CONFIG_META_KEY,
  DEFAULT_PRICES_META_KEY,
  DIFFICULTY_BY_CURRENCY_META_KEY,
  buildStoredDifficultyPrices,
  extractStoredPricingData,
  formatPriceByCurrencyKey,
  formatPriceWithCurrencyConfigs,
  formatPriceWithUnit,
  getCurrencyUnit,
  getPrimaryCurrencyUnit,
  resolvePricingCurrencyKey,
  sanitizeCurrencyConfigs,
  sanitizeCurrencyPriceMap,
  sanitizeDifficultyPricesByCurrency,
} from './currency-unit.util';

describe('currency-unit.util', () => {
  describe('sanitize helpers', () => {
    it('sanitizeCurrencyConfigs dedupes by key and normalizes amount', () => {
      const result = sanitizeCurrencyConfigs([
        { key: 'SOOP_BALLOON', unit: '별풍선', amount: 100.9 },
        { key: 'SOOP_BALLOON', unit: '별풍선', amount: '200' },
        { key: 'CHZZK_CHEESE', unit: '치즈', amount: null },
        { key: '', unit: '원' },
      ]);

      expect(result).toEqual([
        { key: 'SOOP_BALLOON', unit: '별풍선', amount: 200 },
        { key: 'CHZZK_CHEESE', unit: '치즈', amount: null },
      ]);
    });

    it('sanitizeCurrencyPriceMap normalizes numeric values and drops invalid keys', () => {
      expect(
        sanitizeCurrencyPriceMap({
          SOOP_BALLOON: '500',
          CHZZK_CHEESE: 1200.7,
          ' ': 300,
          KRW: '',
        }),
      ).toEqual({
        SOOP_BALLOON: 500,
        CHZZK_CHEESE: 1200,
        KRW: null,
      });
    });

    it('sanitizeDifficultyPricesByCurrency returns normalized map', () => {
      expect(
        sanitizeDifficultyPricesByCurrency({
          SOOP_BALLOON: { '1': '100', '3': 250.4 },
          CHZZK_CHEESE: { '2': null },
        }),
      ).toEqual({
        SOOP_BALLOON: { '1': 100, '3': 250 },
        CHZZK_CHEESE: { '2': null },
      });
    });
  });

  describe('stored pricing serialization', () => {
    it('extractStoredPricingData parses difficulty/default/currency metadata', () => {
      const stored = {
        '1': 50,
        [CURRENCY_CONFIG_META_KEY]: [{ key: 'SOOP_BALLOON', unit: '별풍선' }],
        [DEFAULT_PRICES_META_KEY]: { SOOP_BALLOON: 300 },
        [DIFFICULTY_BY_CURRENCY_META_KEY]: {
          SOOP_BALLOON: { '2': 120 },
        },
      };

      expect(extractStoredPricingData(stored)).toEqual({
        difficultyPrices: { '1': 50 },
        difficultyPricesByCurrency: {
          SOOP_BALLOON: { '2': 120 },
        },
        defaultPrices: { SOOP_BALLOON: 300 },
        currencyConfigs: [{ key: 'SOOP_BALLOON', unit: '별풍선' }],
      });
    });

    it('buildStoredDifficultyPrices returns null when everything is empty', () => {
      expect(
        buildStoredDifficultyPrices({
          difficultyPrices: null,
          difficultyPricesByCurrency: null,
          defaultPrices: null,
          currencyConfigs: [],
        }),
      ).toBeNull();
    });

    it('buildStoredDifficultyPrices serializes all metadata blocks', () => {
      expect(
        buildStoredDifficultyPrices({
          difficultyPrices: { '3': 200 },
          difficultyPricesByCurrency: {
            SOOP_BALLOON: { '3': 250 },
          },
          defaultPrices: { SOOP_BALLOON: 500 },
          currencyConfigs: [{ key: 'SOOP_BALLOON', unit: '별풍선' }],
        }),
      ).toEqual({
        '3': 200,
        [CURRENCY_CONFIG_META_KEY]: [{ key: 'SOOP_BALLOON', unit: '별풍선' }],
        [DEFAULT_PRICES_META_KEY]: { SOOP_BALLOON: 500 },
        [DIFFICULTY_BY_CURRENCY_META_KEY]: {
          SOOP_BALLOON: { '3': 250 },
        },
      });
    });
  });

  describe('currency key/unit resolution', () => {
    it('resolvePricingCurrencyKey prefers platform default key when configured', () => {
      const key = resolvePricingCurrencyKey(StreamPlatform.SOOP, [
        { key: 'CHZZK_CHEESE', unit: '치즈' },
        { key: 'SOOP_BALLOON', unit: '별풍선' },
      ]);

      expect(key).toBe('SOOP_BALLOON');
    });

    it('getPrimaryCurrencyUnit resolves by explicit currencyKey first', () => {
      expect(
        getPrimaryCurrencyUnit(
          StreamPlatform.SOOP,
          [
            { key: 'SOOP_BALLOON', unit: '별풍선' },
            { key: 'CHZZK_CHEESE', unit: '치즈' },
          ],
          'CHZZK_CHEESE',
        ),
      ).toBe('치즈');
    });

    it('getCurrencyUnit falls back to platform defaults', () => {
      expect(getCurrencyUnit(StreamPlatform.SOOP)).toBe('별풍선');
      expect(getCurrencyUnit(StreamPlatform.CHZZK)).toBe('치즈');
      expect(getCurrencyUnit(StreamPlatform.OTHER)).toBe('');
    });
  });

  describe('price formatting', () => {
    it('formatPriceWithUnit appends platform unit', () => {
      expect(formatPriceWithUnit(500, StreamPlatform.SOOP)).toBe('500별풍선');
      expect(formatPriceWithUnit(1000, StreamPlatform.CHZZK)).toBe('1000치즈');
      expect(formatPriceWithUnit(null, StreamPlatform.SOOP)).toBe('');
    });

    it('formatPriceByCurrencyKey formats by selected currency key', () => {
      expect(
        formatPriceByCurrencyKey(
          300,
          'CHZZK_CHEESE',
          [
            { key: 'SOOP_BALLOON', unit: '별풍선' },
            { key: 'CHZZK_CHEESE', unit: '치즈' },
          ],
          StreamPlatform.SOOP,
        ),
      ).toBe('300치즈');
    });

    it('formatPriceWithCurrencyConfigs is compatible with new single-currency snapshot formatting', () => {
      expect(
        formatPriceWithCurrencyConfigs(700, StreamPlatform.SOOP, [
          { key: 'SOOP_BALLOON', unit: '별풍선', amount: null },
          { key: 'CHZZK_CHEESE', unit: '치즈', amount: 1000 },
        ]),
      ).toBe('700별풍선');
    });
  });
});
