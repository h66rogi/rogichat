/* @vitest-environment node */
import { describe, expect, it } from 'vitest';

import {
  reconcile,
  shouldFallbackToLegacy,
  type PlaybackReconcilerState,
} from './playback-reconciler';
import type { OverlayPlaybackSnapshotData } from '../utils/playback-snapshot';

const CLOCK = 1_000;

function snap(
  overrides: Partial<OverlayPlaybackSnapshotData> = {},
): OverlayPlaybackSnapshotData {
  return {
    event: 'overlay.playback.snapshot.v1',
    contractVersion: 1,
    ...overrides,
  };
}

/** A PLAYING now-playing item as the backend emits it (status: 'PLAYING'). */
function playing(requestId: number): Record<string, unknown> {
  return { requestId, status: 'PLAYING', title: `song-${requestId}` };
}

/** Seed reconciler state by applying an initial snapshot. */
function seed(snapshot: OverlayPlaybackSnapshotData): PlaybackReconcilerState {
  return reconcile(null, snapshot, CLOCK).next;
}

describe('reconcile: ordering by (sessionEpoch, revision)', () => {
  it('init: current == null always applies', () => {
    const incoming = snap({ sessionEpoch: 42, revision: 3, nowPlaying: playing(1) });
    const result = reconcile(null, incoming, CLOCK);

    expect(result.action).toBe('apply');
    expect(result.next.sessionEpoch).toBe(42);
    expect(result.next.revision).toBe(3);
    expect(result.next.snapshot).toBe(incoming);
    expect(result.next.pendingNullClear).toBeNull();
    expect(result.next.lastAppliedAt).toBe(CLOCK);
  });

  it('missing revision: applies without dedup (no coercion to 0, no freeze)', () => {
    // Two consecutive keyless snapshots must BOTH apply. Coercing missing->0
    // would make the second look like a duplicate and freeze render.
    const first = snap({ nowPlaying: playing(1) });
    const state1 = reconcile(null, first, CLOCK).next;

    const second = snap({ revision: undefined, sessionEpoch: undefined, nowPlaying: playing(2) });
    const result = reconcile(state1, second, CLOCK + 1);

    expect(result.action).toBe('apply');
    expect(result.next.snapshot).toBe(second);
    expect(result.next.sessionEpoch).toBeNull();
    expect(result.next.revision).toBeNull();
  });

  it('missing sessionEpoch: applies without dedup', () => {
    const state = seed(snap({ sessionEpoch: 10, revision: 5, nowPlaying: playing(1) }));
    const incoming = snap({ sessionEpoch: null, revision: 6, nowPlaying: playing(2) });
    const result = reconcile(state, incoming, CLOCK + 1);

    expect(result.action).toBe('apply');
    expect(result.next.snapshot).toBe(incoming);
  });

  it('keyed snapshot adopts baseline over a keyless-seeded state', () => {
    const keyless = seed(snap({ nowPlaying: playing(1) })); // epoch/revision null
    const keyed = snap({ sessionEpoch: 7, revision: 1, nowPlaying: playing(2) });
    const result = reconcile(keyless, keyed, CLOCK + 1);

    expect(result.action).toBe('apply');
    expect(result.next.sessionEpoch).toBe(7);
    expect(result.next.revision).toBe(1);
  });

  it('older epoch: ignores and preserves current state reference', () => {
    const state = seed(snap({ sessionEpoch: 100, revision: 5, nowPlaying: playing(1) }));
    const older = snap({ sessionEpoch: 99, revision: 999, nowPlaying: null });
    const result = reconcile(state, older, CLOCK + 1);

    expect(result.action).toBe('ignore');
    expect(result.next).toBe(state); // unchanged reference
  });

  it('newer epoch: applies (session transition resets baseline)', () => {
    const state = seed(snap({ sessionEpoch: 100, revision: 5, nowPlaying: playing(1) }));
    const newer = snap({ sessionEpoch: 101, revision: 1, nowPlaying: playing(9) });
    const result = reconcile(state, newer, CLOCK + 1);

    expect(result.action).toBe('apply');
    expect(result.next.sessionEpoch).toBe(101);
    expect(result.next.revision).toBe(1);
    expect(result.next.snapshot).toBe(newer);
  });

  it('newer epoch with null now-playing: applies without holding (cross-session null is authoritative)', () => {
    const state = seed(snap({ sessionEpoch: 100, revision: 5, nowPlaying: playing(1) }));
    const newerNull = snap({ sessionEpoch: 101, revision: 1, nowPlaying: null });
    const result = reconcile(state, newerNull, CLOCK + 1);

    expect(result.action).toBe('apply');
    expect(result.next.snapshot.nowPlaying).toBeNull();
    expect(result.next.pendingNullClear).toBeNull();
  });

  it('equal revision: ignores (duplicate)', () => {
    const state = seed(snap({ sessionEpoch: 100, revision: 5, nowPlaying: playing(1) }));
    const dup = snap({ sessionEpoch: 100, revision: 5, nowPlaying: playing(1) });
    const result = reconcile(state, dup, CLOCK + 1);

    expect(result.action).toBe('ignore');
    expect(result.next).toBe(state);
  });

  it('lower revision (same epoch): ignores (stale)', () => {
    const state = seed(snap({ sessionEpoch: 100, revision: 5, nowPlaying: playing(1) }));
    const stale = snap({ sessionEpoch: 100, revision: 4, nowPlaying: playing(2) });
    const result = reconcile(state, stale, CLOCK + 1);

    expect(result.action).toBe('ignore');
    expect(result.next).toBe(state);
  });

  it('higher revision (same epoch): applies', () => {
    const state = seed(snap({ sessionEpoch: 100, revision: 5, nowPlaying: playing(1) }));
    const next = snap({ sessionEpoch: 100, revision: 6, nowPlaying: playing(2) });
    const result = reconcile(state, next, CLOCK + 1);

    expect(result.action).toBe('apply');
    expect(result.next.revision).toBe(6);
    expect(result.next.snapshot).toBe(next);
  });
});

describe('reconcile: authoritative null clear', () => {
  it('applies the first higher-revision null immediately', () => {
    const state = seed(snap({ sessionEpoch: 100, revision: 5, nowPlaying: playing(1) }));
    const cleared = reconcile(
      state,
      snap({ sessionEpoch: 100, revision: 6, nowPlaying: null }),
      CLOCK + 1,
    );
    expect(cleared.action).toBe('apply');
    expect(cleared.next.snapshot.nowPlaying).toBeNull();
    expect(cleared.next.pendingNullClear).toBeNull();
  });

  it('ignores a duplicate null at the same revision', () => {
    let state = seed(snap({ sessionEpoch: 100, revision: 5, nowPlaying: playing(1) }));
    state = reconcile(
      state,
      snap({ sessionEpoch: 100, revision: 6, nowPlaying: null }),
      CLOCK + 1,
    ).next;
    const duplicate = reconcile(
      state,
      snap({ sessionEpoch: 100, revision: 6, nowPlaying: null }),
      CLOCK + 2,
    );
    expect(duplicate.action).toBe('ignore');
    expect(duplicate.next.snapshot.nowPlaying).toBeNull();
  });

  it('null when nothing was playing applies directly (no spurious hold)', () => {
    const state = seed(snap({ sessionEpoch: 100, revision: 5, nowPlaying: null }));
    const result = reconcile(state, snap({ sessionEpoch: 100, revision: 6, nowPlaying: null }), CLOCK + 1);

    expect(result.action).toBe('apply');
    expect(result.next.pendingNullClear).toBeNull();
  });

  it('injected clock stamps lastAppliedAt on apply but not on ignore', () => {
    const state = seed(snap({ sessionEpoch: 100, revision: 5, nowPlaying: playing(1) }));
    expect(state.lastAppliedAt).toBe(CLOCK);

    const ignored = reconcile(state, snap({ sessionEpoch: 100, revision: 5 }), 9_999);
    expect(ignored.next.lastAppliedAt).toBe(CLOCK); // unchanged on ignore

    const applied = reconcile(state, snap({ sessionEpoch: 100, revision: 6, nowPlaying: playing(2) }), 12_345);
    expect(applied.next.lastAppliedAt).toBe(12_345);
  });
});

describe('shouldFallbackToLegacy: reader staleness fallback (F3)', () => {
  const STALE = 5_000;

  it('no legacy queue.sync exists: never falls back', () => {
    expect(shouldFallbackToLegacy(null, null, 100_000, STALE)).toBe(false);
    expect(shouldFallbackToLegacy(1_000, undefined, 100_000, STALE)).toBe(false);
  });

  it('never received a snapshot but a legacy queue.sync exists: falls back', () => {
    expect(shouldFallbackToLegacy(null, 2_000, 100_000, STALE)).toBe(true);
  });

  it('fresh snapshot within staleMs: does not fall back', () => {
    // now - lastSnapshotAt = 1_000 < 5_000
    expect(shouldFallbackToLegacy(99_000, 99_500, 100_000, STALE)).toBe(false);
  });

  it('stale snapshot AND a newer legacy queue.sync: falls back', () => {
    // now - lastSnapshotAt = 6_000 >= 5_000, legacy (95_000) newer than snapshot (94_000)
    expect(shouldFallbackToLegacy(94_000, 95_000, 100_000, STALE)).toBe(true);
  });

  it('stale snapshot but legacy older than the snapshot: does not fall back', () => {
    // snapshot stale, but no newer legacy sync arrived
    expect(shouldFallbackToLegacy(94_000, 90_000, 100_000, STALE)).toBe(false);
  });
});
