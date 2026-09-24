// Realtime overlay state is event-driven through gateway websocket events.
// Periodic sync is a recovery path for missed events/reconnect gaps, not the
// primary transport. Keep urgent recheck reasons immediate in each widget.
export const OVERLAY_BACKUP_SYNC_INTERVAL_MS = 60_000;
export const OVERLAY_BACKUP_SYNC_MAX_INTERVAL_MS = 180_000;
export const OVERLAY_SYNC_RESPONSE_TIMEOUT_MS = 4_000;

// Snapshot-reader staleness threshold (rollout-safety F3). When the snapshot
// reader is enabled for a channel and no converged snapshot has arrived within
// this window while a newer legacy `queue.sync` exists, the reader steps aside
// and the widget renders its existing (warm) legacy path — i.e. today's
// behavior — so a publish-off channel or a silent snapshot stall never freezes.
export const OVERLAY_SNAPSHOT_READER_STALE_MS = 5_000;
