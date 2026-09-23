/**
 * Collaborative Filtering math primitives for song recommendations.
 *
 * All functions are pure — no side effects, no I/O.
 * See design spec Section 4 for the full derivation.
 */

// ---- Hyperparameters (from spec) ----
const TAU_R = 5; // reliability smoothing
const RHO = 1.5; // neighbor weight sharpening
const MU = 10; // Bayesian shrinkage strength
const GAMMA = 0.3; // popularity correction
const TAU_BLEND = 20; // user-CF vs item-CF blend
const LAMBDA_SHRINK = 10; // item-item shrinkage
const EPSILON = 1e-7; // numerical stability clamp
const ALPHA = 1; // Tversky α (target penalty)
const BETA = 0.5; // Tversky β (neighbor tolerance)

// ---- Song Weight ----

/** Smoothed IDF × reliability. w(s) from spec. */
export function songWeight(df: number, N: number): number {
  if (df <= 0 || N <= 0) return 0;
  const idf = Math.log(1 + N / df);
  const wMax = Math.log(1 + N / 2);
  const r = Math.sqrt(df / (df + TAU_R));
  return Math.min(idf, wMax) * r;
}

// ---- Tversky Similarity ----

/**
 * Weighted Tversky similarity T(C, D).
 *
 * @param intersection  weighted intersection Σ w(s) · x(C,s) · x(D,s)
 * @param massC         weighted mass of target channel
 * @param massD         weighted mass of candidate neighbor
 */
export function tverskySimilarity(
  intersection: number,
  massC: number,
  massD: number,
): number {
  if (intersection <= 0) return 0;
  const denom =
    intersection +
    ALPHA * (massC - intersection) +
    BETA * (massD - intersection);
  return denom > 0 ? intersection / denom : 0;
}

// ---- User-CF Score ----

/**
 * Bayesian posterior + novelty uplift for a candidate song s in channel C.
 *
 * @param neighborVotes  n(C,s) = Σ a(j) · x(j,s) over K neighbors
 * @param totalWeight    W_C = Σ a(j)
 * @param globalPrevalence  p(s) = df(s) / N
 */
export function userCFScore(
  neighborVotes: number,
  totalWeight: number,
  globalPrevalence: number,
): number {
  const theta = (neighborVotes + MU * globalPrevalence) / (totalWeight + MU);
  const thetaC = clip(theta, EPSILON, 1 - EPSILON);
  const pC = clip(globalPrevalence, EPSILON, 1 - EPSILON);
  return logOdds(thetaC) - GAMMA * logOdds(pC);
}

/** Sharpen neighbor weight: a(j) = T(C,j)^ρ */
export function sharpenWeight(similarity: number): number {
  return Math.pow(similarity, RHO);
}

// ---- Item-Item Similarity ----

/**
 * Shrunk PMI+ item-item similarity.
 *
 * @param cooccurrence  n_co(s,t) = channels containing both
 * @param dfS           df(s)
 * @param dfT           df(t)
 * @param N             total channels
 */
export function itemSimilarity(
  cooccurrence: number,
  dfS: number,
  dfT: number,
  N: number,
): number {
  if (cooccurrence <= 0 || dfS <= 0 || dfT <= 0 || N <= 0) return 0;
  const pmi = Math.log((N * cooccurrence) / (dfS * dfT));
  const pmiPlus = Math.max(0, pmi);
  const shrink = cooccurrence / (cooccurrence + LAMBDA_SHRINK);
  return shrink * pmiPlus;
}

/**
 * Item-CF score for candidate song s in channel C.
 *
 * @param channelSongSimilarities  sim_item(s, t) for each t ∈ C
 * @param channelSize  |C|
 */
export function itemCFScore(
  channelSongSimilarities: number[],
  channelSize: number,
): number {
  if (channelSize <= 0 || channelSongSimilarities.length === 0) return 0;
  const sum = channelSongSimilarities.reduce((a, b) => a + b, 0);
  return sum / channelSize;
}

// ---- Hybrid Blending ----

/**
 * Hybrid score blending user-CF and item-CF by channel size.
 */
export function hybridScore(
  userCF: number,
  itemCF: number,
  channelSize: number,
): number {
  const lambda = channelSize / (channelSize + TAU_BLEND);
  return lambda * userCF + (1 - lambda) * itemCF;
}

// ---- MMR Diversity Reranking ----

const LAMBDA_MMR = 0.7;

/**
 * MMR score for candidate s given already-selected set R.
 *
 * @param relevance     hybrid score of candidate s
 * @param maxSimToSelected  max sim_item(s, r) for r ∈ R
 */
export function mmrScore(relevance: number, maxSimToSelected: number): number {
  return LAMBDA_MMR * relevance - (1 - LAMBDA_MMR) * maxSimToSelected;
}

/**
 * Greedy MMR selection: pick top-K from candidates.
 *
 * @param candidates  array of { id, relevance }
 * @param simFn       function returning sim(a, b) between two candidate IDs
 * @param k           number of items to select
 */
export function mmrSelect<T extends { id: number; relevance: number }>(
  candidates: T[],
  simFn: (a: number, b: number) => number,
  k: number,
): T[] {
  if (candidates.length === 0 || k <= 0) return [];

  const selected: T[] = [];
  const remaining = [...candidates];

  // First pick: highest relevance
  remaining.sort((a, b) => b.relevance - a.relevance);
  selected.push(remaining.shift());

  while (selected.length < k && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      const maxSim = Math.max(...selected.map((s) => simFn(cand.id, s.id)));
      const score = mmrScore(cand.relevance, maxSim);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    selected.push(remaining.splice(bestIdx, 1)[0]);
  }

  return selected;
}

// ---- Utilities ----

function clip(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function logOdds(p: number): number {
  return Math.log(p / (1 - p));
}
