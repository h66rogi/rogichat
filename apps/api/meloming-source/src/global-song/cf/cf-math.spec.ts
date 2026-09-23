import {
  songWeight,
  tverskySimilarity,
  userCFScore,
  sharpenWeight,
  itemSimilarity,
  itemCFScore,
  hybridScore,
  mmrScore,
  mmrSelect,
} from './cf-math';

describe('CF math primitives', () => {
  // Shared constants from spec
  const N = 2375; // prod channel count from spec

  describe('songWeight', () => {
    it('returns 0 for df=0 or N=0', () => {
      expect(songWeight(0, N)).toBe(0);
      expect(songWeight(10, 0)).toBe(0);
    });

    it('df=1 (singleton) has high IDF but low reliability', () => {
      const w = songWeight(1, N);
      expect(w).toBeGreaterThan(0);
      expect(w).toBeLessThan(songWeight(10, N)); // reliability drag
    });

    it('df=500 (밤편지) has moderate weight', () => {
      const w = songWeight(500, N);
      expect(w).toBeGreaterThan(0);
      // Should be less than df=50 (IDF dominates at low df)
      expect(w).toBeLessThan(songWeight(50, N));
    });

    it('weight is bounded by wMax * r', () => {
      const w = songWeight(1, N);
      const wMax = Math.log(1 + N / 2);
      expect(w).toBeLessThanOrEqual(wMax);
    });
  });

  describe('tverskySimilarity', () => {
    it('returns 0 when no intersection', () => {
      expect(tverskySimilarity(0, 10, 10)).toBe(0);
    });

    it('identical channels have similarity 1', () => {
      // If C == D: intersection == massC == massD
      const mass = 50;
      expect(tverskySimilarity(mass, mass, mass)).toBeCloseTo(1, 5);
    });

    it('asymmetric: T(small, big) != T(big, small)', () => {
      // Small channel C (mass 10) vs big neighbor D (mass 100), intersection 8
      const t1 = tverskySimilarity(8, 10, 100);
      // Big channel C (mass 100) vs small neighbor D (mass 10), intersection 8
      const t2 = tverskySimilarity(8, 100, 10);
      expect(t1).not.toBeCloseTo(t2, 3);
      // Small channel C gets a higher similarity (β tolerates big D)
      expect(t1).toBeGreaterThan(t2);
    });
  });

  describe('sharpenWeight', () => {
    it('sharpens via ρ=1.5 exponent', () => {
      expect(sharpenWeight(1)).toBeCloseTo(1, 5);
      expect(sharpenWeight(0.5)).toBeCloseTo(Math.pow(0.5, 1.5), 5);
      expect(sharpenWeight(0)).toBe(0);
    });
  });

  describe('userCFScore', () => {
    it('positive uplift when neighbors strongly endorse', () => {
      // Many neighbors vote for song s, low global prevalence
      const score = userCFScore(8, 10, 0.01);
      expect(score).toBeGreaterThan(0);
    });

    it('negative uplift when only popular songs appear (no personalization)', () => {
      // Weak neighbor signal for a very popular song
      const score = userCFScore(0.1, 10, 0.8);
      expect(score).toBeLessThan(0);
    });

    it('handles edge case: totalWeight=0', () => {
      const score = userCFScore(0, 0, 0.5);
      // Should not throw, should return something finite
      expect(isFinite(score)).toBe(true);
    });
  });

  describe('itemSimilarity', () => {
    it('returns 0 when no co-occurrence', () => {
      expect(itemSimilarity(0, 100, 100, N)).toBe(0);
    });

    it('positive for co-occurrence above independence baseline', () => {
      // 50 channels have both songs, each appears in 100 channels out of 2375
      const sim = itemSimilarity(50, 100, 100, N);
      expect(sim).toBeGreaterThan(0);
    });

    it('shrinkage reduces score at low co-occurrence', () => {
      const sim3 = itemSimilarity(3, 100, 100, N);
      const sim30 = itemSimilarity(30, 100, 100, N);
      // sim30 should be higher (less shrinkage + higher PMI)
      expect(sim30).toBeGreaterThan(sim3);
    });

    it('PMI+ floors at 0 (never negative)', () => {
      // Songs that co-occur LESS than expected by independence
      // df=100 each, co-occur in 1 channel, N=2375
      // Expected co-occ = 100*100/2375 ≈ 4.2, actual = 1 → negative PMI
      const sim = itemSimilarity(1, 100, 100, N);
      expect(sim).toBe(0); // PMI+ clips to 0
    });
  });

  describe('itemCFScore', () => {
    it('returns 0 for empty channel', () => {
      expect(itemCFScore([], 0)).toBe(0);
    });

    it('averages similarities across channel songs', () => {
      const score = itemCFScore([0.5, 0.3, 0.2], 3);
      expect(score).toBeCloseTo((0.5 + 0.3 + 0.2) / 3, 5);
    });
  });

  describe('hybridScore', () => {
    it('small channel (5 songs) is item-CF dominant', () => {
      const score = hybridScore(1.0, 2.0, 5);
      const lambda = 5 / (5 + 20);
      expect(score).toBeCloseTo(lambda * 1.0 + (1 - lambda) * 2.0, 5);
      expect(lambda).toBeLessThan(0.3);
    });

    it('large channel (100 songs) is user-CF dominant', () => {
      const lambda = 100 / (100 + 20);
      expect(lambda).toBeGreaterThan(0.8);
    });

    it('balanced at ~20 songs', () => {
      const lambda = 20 / (20 + 20);
      expect(lambda).toBeCloseTo(0.5, 5);
    });
  });

  describe('mmrScore', () => {
    it('high relevance + low redundancy → high MMR', () => {
      expect(mmrScore(1.0, 0.0)).toBeGreaterThan(mmrScore(1.0, 0.8));
    });

    it('relevance dominates (λ_mmr = 0.7)', () => {
      expect(mmrScore(1.0, 0.5)).toBeGreaterThan(0);
    });
  });

  describe('mmrSelect', () => {
    it('returns empty for empty candidates', () => {
      expect(mmrSelect([], () => 0, 5)).toEqual([]);
    });

    it('picks highest relevance first, then diversifies', () => {
      const candidates = [
        { id: 1, relevance: 0.9 },
        { id: 2, relevance: 0.85 },
        { id: 3, relevance: 0.8 },
      ];
      // id 1 and id 2 are very similar, id 3 is different
      const simFn = (a: number, b: number) => {
        if ((a === 1 && b === 2) || (a === 2 && b === 1)) return 0.95;
        return 0.1;
      };

      const selected = mmrSelect(candidates, simFn, 2);
      expect(selected[0].id).toBe(1); // highest relevance
      // Second pick should be 3 (diverse) not 2 (redundant with 1)
      expect(selected[1].id).toBe(3);
    });

    it('respects k limit', () => {
      const candidates = Array.from({ length: 10 }, (_, i) => ({
        id: i,
        relevance: 1 - i * 0.1,
      }));
      const selected = mmrSelect(candidates, () => 0, 3);
      expect(selected).toHaveLength(3);
    });
  });
});
