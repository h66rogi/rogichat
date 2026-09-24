/**
 * Authoritative playback snapshot reconciler.
 *
 * Pure, framework-free convergence logic for the authoritative overlay playback
 * snapshot. No React, no socket, no wall-clock read except through the injected
 * `now` argument, so every branch is deterministically unit-testable.
 *
 * The overlay snapshot is a FULL state payload (queue/setlist/nowPlaying/...),
 * NOT a delta. Ordering is therefore total on `(sessionEpoch, revision)` and a
 * gap self-heals by applying the latest full snapshot: there is no delta-gap
 * refetch. Field semantics (verified against meloming-back
 * `OverlayPlaybackSnapshotDto` / `OverlayService.buildPlaybackSnapshot`):
 *   - sessionEpoch = LiveSession.id (autoincrement → monotonic per token; the
 *     just-ended session's id after live end; null only if no session ever existed)
 *   - revision     = LiveSession.playbackRevision (per-session monotonic counter,
 *     bumped { increment: 1 } inside each command transaction; null with epoch)
 *
 * Reducer contract (runbook 464-470 + review corrections F1/F5):
 *   current == null                                   -> apply (init)
 *   incoming epoch|revision == null                   -> apply, NO dedup
 *   incoming.sessionEpoch < current.sessionEpoch      -> ignore (older session)
 *   incoming.sessionEpoch > current.sessionEpoch      -> apply (session transition)
 *   same epoch & incoming.revision <= current.revision-> ignore (dup/stale)
 *   same epoch & incoming.revision >  current.revision-> apply
 *
 * Authoritative nowPlaying:null handling: a higher-revision full snapshot is a
 * committed state transition, so a single null clears immediately. Requiring a
 * second revision would retain the final song forever when the session ends.
 */

import type { OverlayPlaybackSnapshotData } from '@/domains/overlay/utils/playback-snapshot';

export type ReconcileAction = 'apply' | 'ignore';

/** A pending, not-yet-confirmed now-playing clear, keyed by the requesting revision. */
export interface PendingNullClear {
  sessionEpoch: number;
  atRevision: number;
}

export interface PlaybackReconcilerState {
  /** Ordering key of the converged snapshot (null only while seeded from a keyless snapshot). */
  sessionEpoch: number | null;
  revision: number | null;
  /** The snapshot the consumer should render. During 'hold-null' its nowPlaying is the held PLAYING row. */
  snapshot: OverlayPlaybackSnapshotData;
  /** Set while a null-clear is awaiting confirmation; null otherwise. */
  pendingNullClear: PendingNullClear | null;
  /** Injected-clock timestamp (ms) of the last apply/hold. Untouched on ignore. */
  lastAppliedAt: number;
}

export interface ReconcileResult {
  action: ReconcileAction;
  next: PlaybackReconcilerState;
}

/** Coerce an optional ordering key to a usable number, or null when missing/invalid. */
function normalizeKey(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function apply(
  snapshot: OverlayPlaybackSnapshotData,
  sessionEpoch: number | null,
  revision: number | null,
  pendingNullClear: PendingNullClear | null,
  now: number,
): ReconcileResult {
  return {
    action: 'apply',
    next: { sessionEpoch, revision, snapshot, pendingNullClear, lastAppliedAt: now },
  };
}

function ignore(current: PlaybackReconcilerState): ReconcileResult {
  return { action: 'ignore', next: current };
}

/**
 * Same-session (equal epoch), strictly-higher revision. Applies the incoming
 * snapshot. A durable, versioned full snapshot is authoritative including a
 * single nowPlaying:null transition; waiting for a second command would retain
 * an ended song forever when no later command exists.
 */
function applySameSession(
  incoming: OverlayPlaybackSnapshotData,
  sessionEpoch: number,
  revision: number,
  now: number,
): ReconcileResult {
  return apply(incoming, sessionEpoch, revision, null, now);
}

/**
 * Reconcile the converged playback state with an incoming full snapshot.
 * Pure: never mutates `current` or `incoming`. `now` is the injected clock (ms).
 */
export function reconcile(
  current: PlaybackReconcilerState | null,
  incoming: OverlayPlaybackSnapshotData,
  now: number = Date.now(),
): ReconcileResult {
  const sessionEpoch = normalizeKey(incoming.sessionEpoch);
  const revision = normalizeKey(incoming.revision);

  // Init: first snapshot always applies.
  if (current === null) {
    return apply(incoming, sessionEpoch, revision, null, now);
  }

  // Missing ordering key: apply without dedup. Never coerce a missing key to 0,
  // that would make the first real counter snapshot look stale and freeze render.
  if (sessionEpoch === null || revision === null) {
    return apply(incoming, sessionEpoch, revision, null, now);
  }

  // Current was seeded from a keyless snapshot; adopt this keyed one as baseline.
  if (current.sessionEpoch === null || current.revision === null) {
    return apply(incoming, sessionEpoch, revision, null, now);
  }

  // Older session: ignore. An older session's state (incl. null) must never
  // overwrite a newer session's now-playing.
  if (sessionEpoch < current.sessionEpoch) {
    return ignore(current);
  }

  // Newer session: apply and reset the baseline. A new session genuinely has no
  // carry-over now-playing, so a cross-session null is authoritative (no hold).
  if (sessionEpoch > current.sessionEpoch) {
    return apply(incoming, sessionEpoch, revision, null, now);
  }

  // Same session, dup or stale revision: ignore.
  if (revision <= current.revision) {
    return ignore(current);
  }

  // Same session, higher revision: apply with the bounded null-clear debounce.
  return applySameSession(incoming, sessionEpoch, revision, now);
}

/**
 * Reader-side staleness fallback (rollout-safety F3). Returns true when no
 * snapshot has arrived within `staleMs` while a newer legacy `queue.sync` exists,
 * so a publish-off channel or a silent snapshot-pipeline stall degrades to the
 * existing queue.sync path instead of freezing on the last snapshot.
 *
 * @param lastSnapshotAt          ms timestamp a snapshot last arrived (null = never)
 * @param latestLegacyQueueSyncAt ms timestamp a legacy queue.sync last arrived (null = none)
 * @param now                     current time (ms, injected)
 * @param staleMs                 staleness threshold
 */
export function shouldFallbackToLegacy(
  lastSnapshotAt: number | null | undefined,
  latestLegacyQueueSyncAt: number | null | undefined,
  now: number,
  staleMs: number,
): boolean {
  // Nothing to fall back to.
  if (latestLegacyQueueSyncAt == null) {
    return false;
  }
  // Never received any snapshot, but a legacy queue.sync exists → use legacy.
  if (lastSnapshotAt == null) {
    return true;
  }
  const snapshotAgeExceeded = now - lastSnapshotAt >= staleMs;
  const legacyIsNewer = latestLegacyQueueSyncAt > lastSnapshotAt;
  return snapshotAgeExceeded && legacyIsNewer;
}
