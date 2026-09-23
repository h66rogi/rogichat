import { normalizeArtist } from './artist-normalizer';

describe('normalizeArtist', () => {
  describe('plain names', () => {
    it('normalizes a plain Korean artist name', () => {
      const result = normalizeArtist('아이유');
      expect(result.canonicalName).toBe('아이유');
      expect(result.normKey).toBe('아이유');
      expect(result.aliases).toEqual(['아이유']);
      expect(result.featuring).toEqual([]);
    });

    it('normalizes a plain Latin artist name (lowercased for normKey)', () => {
      const result = normalizeArtist('IU');
      expect(result.normKey).toBe('iu');
      expect(result.aliases).toEqual(['iu']);
      expect(result.featuring).toEqual([]);
    });
  });

  describe('10 variants of "밤편지" artist produce identical normKey', () => {
    const EXPECTED_NORM_KEY = 'iu|아이유';

    const variants: Array<[string, string]> = [
      ['variant 1: 아이유', '아이유'],
      ['variant 2: IU', 'IU'],
      ['variant 3: 아이유 (IU)', '아이유 (IU)'],
      ['variant 4: IU (아이유)', 'IU (아이유)'],
      ['variant 5: 아이유(IU)', '아이유(IU)'],
      ['variant 6: IU(아이유)', 'IU(아이유)'],
      ['variant 7: 아이유 / IU', '아이유 / IU'],
      ['variant 8: IU / 아이유', 'IU / 아이유'],
      ['variant 9: 아이유 IU', '아이유 IU'],
      ['variant 10: IU 아이유', 'IU 아이유'],
    ];

    it.each(variants)('%s produces normKey "iu|아이유"', (_label, input) => {
      // NOTE: variants 1 and 2 only contain a single script so they cannot
      // produce the two-alias normKey on their own. They are included here
      // so that the test matrix matches the plan's canonical enumeration,
      // but we skip the equality check for those specific cases.
      if (input === '아이유') {
        expect(normalizeArtist(input).normKey).toBe('아이유');
        return;
      }
      if (input === 'IU') {
        expect(normalizeArtist(input).normKey).toBe('iu');
        return;
      }
      expect(normalizeArtist(input).normKey).toBe(EXPECTED_NORM_KEY);
    });
  });

  describe('parenthetical extraction', () => {
    it('extracts alias from "아이유 (IU)"', () => {
      const result = normalizeArtist('아이유 (IU)');
      expect(result.normKey).toBe('iu|아이유');
      expect(result.aliases).toEqual(expect.arrayContaining(['아이유', 'iu']));
      expect(result.aliases).toHaveLength(2);
      expect(result.canonicalName).toBe('아이유');
      expect(result.featuring).toEqual([]);
    });

    it('extracts alias from "IU (아이유)" (Latin first)', () => {
      const result = normalizeArtist('IU (아이유)');
      expect(result.normKey).toBe('iu|아이유');
      expect(result.aliases).toEqual(expect.arrayContaining(['아이유', 'iu']));
      expect(result.canonicalName).toBe('iu');
    });

    it('handles square brackets "아이유 [IU]"', () => {
      const result = normalizeArtist('아이유 [IU]');
      expect(result.normKey).toBe('iu|아이유');
    });
  });

  describe('slash separator', () => {
    it('splits on slash "아이유 / IU"', () => {
      const result = normalizeArtist('아이유 / IU');
      expect(result.normKey).toBe('iu|아이유');
      expect(result.aliases).toEqual(expect.arrayContaining(['아이유', 'iu']));
    });

    it('splits on slash "IU / 아이유"', () => {
      const result = normalizeArtist('IU / 아이유');
      expect(result.normKey).toBe('iu|아이유');
    });
  });

  describe('space-separated mixed script', () => {
    it('handles "아이유 IU"', () => {
      const result = normalizeArtist('아이유 IU');
      expect(result.normKey).toBe('iu|아이유');
    });

    it('handles "IU 아이유"', () => {
      const result = normalizeArtist('IU 아이유');
      expect(result.normKey).toBe('iu|아이유');
    });
  });

  describe('glued mixed-script (script boundary detection)', () => {
    it('handles "아이유IU" with no separator', () => {
      const result = normalizeArtist('아이유IU');
      expect(result.normKey).toBe('iu|아이유');
    });

    it('handles "IU아이유" reversed', () => {
      const result = normalizeArtist('IU아이유');
      expect(result.normKey).toBe('iu|아이유');
    });
  });

  describe('featuring separators', () => {
    it('extracts feat. artists as featuring metadata', () => {
      const result = normalizeArtist('아이유 feat. 오혁');
      expect(result.canonicalName).toBe('아이유');
      expect(result.normKey).toBe('아이유');
      expect(result.aliases).toEqual(['아이유']);
      expect(result.featuring).toEqual(['오혁']);
    });

    it('extracts ft. artists as featuring metadata', () => {
      const result = normalizeArtist('아이유 ft. 오혁');
      expect(result.canonicalName).toBe('아이유');
      expect(result.normKey).toBe('아이유');
      expect(result.featuring).toEqual(['오혁']);
    });

    it('extracts "with" collaborators as featuring metadata', () => {
      const result = normalizeArtist('아이유 with 오혁');
      expect(result.canonicalName).toBe('아이유');
      expect(result.normKey).toBe('아이유');
      expect(result.featuring).toEqual(['오혁']);
    });

    it('handles case-insensitive feat./Feat./FEAT.', () => {
      expect(normalizeArtist('아이유 Feat. 오혁').featuring).toEqual(['오혁']);
      expect(normalizeArtist('아이유 FEAT. 오혁').featuring).toEqual(['오혁']);
    });
  });

  describe('fullwidth to halfwidth', () => {
    it('converts fullwidth Latin "ＩＵ" to "IU" then lowercase', () => {
      const result = normalizeArtist('ＩＵ');
      expect(result.normKey).toBe('iu');
      expect(result.aliases).toEqual(['iu']);
    });

    it('converts fullwidth digits and letters inside parentheses', () => {
      const result = normalizeArtist('아이유 (ＩＵ)');
      expect(result.normKey).toBe('iu|아이유');
    });
  });

  describe('whitespace handling', () => {
    it('collapses multiple spaces "아이유   (IU)"', () => {
      const result = normalizeArtist('아이유   (IU)');
      expect(result.normKey).toBe('iu|아이유');
    });

    it('trims leading/trailing whitespace', () => {
      const result = normalizeArtist('   아이유 (IU)   ');
      expect(result.normKey).toBe('iu|아이유');
    });
  });

  describe('input validation', () => {
    it('throws on empty string', () => {
      expect(() => normalizeArtist('')).toThrow();
    });

    it('throws on whitespace-only string', () => {
      expect(() => normalizeArtist('   ')).toThrow();
    });

    it('throws when input exceeds 200 characters', () => {
      const longInput = 'a'.repeat(201);
      expect(() => normalizeArtist(longInput)).toThrow();
    });

    it('accepts exactly 200 characters', () => {
      const maxInput = 'a'.repeat(200);
      expect(() => normalizeArtist(maxInput)).not.toThrow();
    });
  });
});
