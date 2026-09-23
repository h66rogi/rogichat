import { normalizeTitle } from './title-normalizer';

describe('normalizeTitle', () => {
  describe('validation', () => {
    it('throws on empty string', () => {
      expect(() => normalizeTitle('')).toThrow();
    });

    it('throws on whitespace-only', () => {
      expect(() => normalizeTitle('   ')).toThrow();
    });

    it('throws on input longer than 300 characters', () => {
      expect(() => normalizeTitle('a'.repeat(301))).toThrow();
    });

    it('accepts exactly 300 characters', () => {
      expect(() => normalizeTitle('a'.repeat(300))).not.toThrow();
    });
  });

  describe('plain titles', () => {
    it('normalizes a plain Korean title', () => {
      const result = normalizeTitle('밤편지');
      expect(result.normTitle).toBe('밤편지');
      expect(result.aliases).toEqual([]);
    });

    it('lowercases a plain Latin title', () => {
      const result = normalizeTitle('Love wins all');
      expect(result.normTitle).toBe('love wins all');
      expect(result.aliases).toEqual([]);
    });
  });

  describe('translation parenthetical removal', () => {
    it('removes translation parenthetical and registers alias', () => {
      const result = normalizeTitle('밤편지 (My Night)');
      expect(result.normTitle).toBe('밤편지');
      expect(result.aliases).toEqual(['my night']);
    });

    it('handles bracketed translation', () => {
      const result = normalizeTitle('Pet [펫]');
      expect(result.normTitle).toBe('pet');
      expect(result.aliases).toEqual(['펫']);
    });

    it('handles Korean translation for English title', () => {
      const result = normalizeTitle('Love Scenario (사랑이라는 이름을 가진 것)');
      expect(result.normTitle).toBe('love scenario');
      expect(result.aliases).toEqual(['사랑이라는 이름을 가진 것']);
    });

    it('handles empty bracket without creating alias', () => {
      const result = normalizeTitle('밤편지 ()');
      expect(result.normTitle).toBe('밤편지');
      expect(result.aliases).toEqual([]);
    });
  });

  describe('version keyword preservation', () => {
    it('preserves (Live) as version keyword', () => {
      const result = normalizeTitle('밤편지 (Live)');
      expect(result.normTitle).toBe('밤편지 (live)');
      expect(result.aliases).toEqual([]);
    });

    it('preserves (Inst)', () => {
      const result = normalizeTitle('밤편지 (Inst)');
      expect(result.normTitle).toBe('밤편지 (inst)');
    });

    it('preserves (Instrumental)', () => {
      const result = normalizeTitle('밤편지 (Instrumental)');
      expect(result.normTitle).toBe('밤편지 (instrumental)');
    });

    it('preserves (Remix)', () => {
      const result = normalizeTitle('Hype Boy (Remix)');
      expect(result.normTitle).toBe('hype boy (remix)');
    });

    it('preserves (Acoustic Ver.)', () => {
      const result = normalizeTitle('밤편지 (Acoustic Ver.)');
      expect(result.normTitle).toBe('밤편지 (acoustic ver.)');
    });

    it('preserves (Cover)', () => {
      const result = normalizeTitle('밤편지 (Cover)');
      expect(result.normTitle).toBe('밤편지 (cover)');
    });

    it('is case-insensitive for version keyword detection', () => {
      expect(normalizeTitle('밤편지 (LIVE)').normTitle).toBe('밤편지 (live)');
      expect(normalizeTitle('밤편지 (Live)').normTitle).toBe('밤편지 (live)');
    });
  });

  describe('multiple brackets', () => {
    it('keeps version bracket and drops translation bracket', () => {
      const result = normalizeTitle('밤편지 (My Night) (Live)');
      expect(result.normTitle).toBe('밤편지 (live)');
      expect(result.aliases).toEqual(['my night']);
    });
  });

  describe('Unicode normalization', () => {
    it('converts fullwidth Latin to halfwidth and lowercases', () => {
      const result = normalizeTitle('ＩＵ Love wins');
      expect(result.normTitle).toBe('iu love wins');
    });

    it('supports fullwidth brackets as translation brackets', () => {
      const result = normalizeTitle('밤편지（My Night）');
      expect(result.normTitle).toBe('밤편지');
      expect(result.aliases).toEqual(['my night']);
    });
  });

  describe('whitespace handling', () => {
    it('collapses internal whitespace', () => {
      const result = normalizeTitle('밤편지   (My   Night)');
      expect(result.normTitle).toBe('밤편지');
      expect(result.aliases).toEqual(['my night']);
    });

    it('trims leading/trailing whitespace', () => {
      expect(normalizeTitle('  밤편지  ').normTitle).toBe('밤편지');
    });
  });

  describe('displayTitle', () => {
    it('preserves original case in displayTitle', () => {
      const result = normalizeTitle('Hype Boy (Live)');
      expect(result.displayTitle).toBe('Hype Boy (Live)');
    });

    it('trims and collapses whitespace in displayTitle but keeps case', () => {
      const result = normalizeTitle('  Hype   Boy  ');
      expect(result.displayTitle).toBe('Hype Boy');
    });
  });

  describe('ambiguous non-version bracket', () => {
    // Design choice: any non-version bracket is treated as a translation
    // alias. This is documented behavior for the first iteration.
    it('treats numeric bracket as translation alias', () => {
      const result = normalizeTitle('Song (2)');
      expect(result.normTitle).toBe('song');
      expect(result.aliases).toEqual(['2']);
    });
  });
});
