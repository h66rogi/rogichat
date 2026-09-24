/**
 * Per-channel client flag for the overlay snapshot READER cutover.
 *
 * DEFAULT ON for every channel. The Redis-backed authoritative snapshot is the
 * normal playback source; removing a deployment variable must never silently
 * restore the high-traffic polling path.
 *
 * Set NEXT_PUBLIC_OVERLAY_SNAPSHOT_READER_ALL=false to use the legacy path for
 * every channel. For a scoped re-enable, also list each channel's `webPath`
 * and/or overlay `token` in NEXT_PUBLIC_OVERLAY_SNAPSHOT_READER_CHANNELS.
 *
 * The reader is still gated at runtime by whether a snapshot actually arrives
 * (staleness fallback in `shouldFallbackToLegacy`), so enabling the flag for a
 * channel whose backend publish is off degrades to today's `queue.sync` path.
 *
 * NOTE: `process.env.NEXT_PUBLIC_*` is read via direct static property access so
 * Next.js inlines the literal at build time. Do not refactor to dynamic keys.
 */

export interface SnapshotReaderChannelRef {
  token?: string | null;
  webPath?: string | null;
}

function isGloballyEnabled(raw: string | undefined | null): boolean {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return true;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized !== 'false';
}

/** True when authoritative playback is globally enabled. Default true. */
export function isSnapshotReaderAllEnabled(): boolean {
  return isGloballyEnabled(
    process.env.NEXT_PUBLIC_OVERLAY_SNAPSHOT_READER_ALL,
  );
}

/**
 * Parse the comma-separated allowlist into a set of trimmed, non-empty entries
 * plus their lowercased variants (webPath slugs are case-insensitive; opaque
 * tokens are matched both exact and lowercased so an operator typo in case
 * still matches).
 */
function parseAllowlist(raw: string | undefined | null): Set<string> {
  const out = new Set<string>();
  if (typeof raw !== 'string' || raw.trim() === '') {
    return out;
  }
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    out.add(trimmed);
    out.add(trimmed.toLowerCase());
  }
  return out;
}

function candidateKeys(
  channel: SnapshotReaderChannelRef | string | null | undefined,
): string[] {
  if (channel == null) {
    return [];
  }
  const raw =
    typeof channel === 'string'
      ? [channel]
      : [channel.token ?? undefined, channel.webPath ?? undefined];
  const keys: string[] = [];
  for (const value of raw) {
    if (typeof value !== 'string') {
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    keys.push(trimmed, trimmed.toLowerCase());
  }
  return keys;
}

/**
 * Whether the snapshot reader is enabled for the given channel (matched by its
 * overlay `token` and/or `webPath`). Returns `true` for every channel when
 * the flags are unset. Explicit ALL=false activates the rollback/allowlist
 * behavior.
 */
export function isSnapshotReaderEnabled(
  channel: SnapshotReaderChannelRef | string | null | undefined,
): boolean {
  if (isSnapshotReaderAllEnabled()) {
    return true;
  }
  const allowlist = parseAllowlist(
    process.env.NEXT_PUBLIC_OVERLAY_SNAPSHOT_READER_CHANNELS,
  );
  if (allowlist.size === 0) {
    return false;
  }
  for (const key of candidateKeys(channel)) {
    if (allowlist.has(key)) {
      return true;
    }
  }
  return false;
}

/**
 * Runtime switch for the Redis-backed authoritative playback source.
 * The old "reader" name described an implementation detail, not its role.
 */
export const isAuthoritativePlaybackEnabled = isSnapshotReaderEnabled;
