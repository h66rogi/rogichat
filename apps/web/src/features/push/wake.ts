/**
 * Wake handling for the service worker.
 *
 * A message wake carries opaque room/message IDs, with no author, text or URL.
 * The destination rechecks current membership and message access on every tap.
 *
 * A wake is a hint that the client should re-read its own data with its own credentials.
 * Receiving one proves nothing about what changed, so the generic notification below must not
 * claim a new message; the real content appears only after an authenticated sync.
 *
 * The worker keeps no private caches. There is no Cache API storage for API responses, media
 * or messages anywhere in this app, and nothing here introduces any: an account switch has to
 * invalidate in-memory work, not evict stored private data.
 *
 * This module is the source of truth for that logic. `public/sw.js` is served verbatim from
 * the web origin and is owned outside this module; docs/web-push-integration.md records the
 * exact handlers it has to contain and the state it must not keep.
 */

export const WAKE_ONLY_PUSH = Object.freeze({ type: 'sync_required', version: 1 } as const);
export type WakeOnlyPush = typeof WAKE_ONLY_PUSH | { type: 'sync_required'; version: 1; roomId: string; messageId: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Accepts exactly the contract payload: right type, right version, no additional fields. */
export function isWakePayload(value: unknown): value is WakeOnlyPush {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return record.type === WAKE_ONLY_PUSH.type && record.version === WAKE_ONLY_PUSH.version &&
    (keys.length === 2 || keys.length === 4 && UUID.test(String(record.roomId)) && UUID.test(String(record.messageId)));
}

/** Parses raw push data. Unparseable or unexpected data is not treated as a wake. */
export function readWakePayload(raw: string | null | undefined): boolean {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 256) return false;
  try {
    return isWakePayload(JSON.parse(raw));
  } catch {
    return false;
  }
}

/**
 * Text for the notification a wake must show, because `userVisibleOnly` subscriptions owe the
 * user something visible. It states only that there may be something to read: the worker has
 * no message content or sender, and inventing one would be a claim the payload cannot support.
 */
export const WAKE_NOTIFICATION = Object.freeze({
  title: '로기챗',
  body: '확인할 내용이 있는지 로기챗에서 확인해 주세요.',
  tag: 'rogichat-sync',
  renotify: false,
} as const);

const TOKEN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Which account and session the worker is doing work for.
 *
 * Account and session alone are not enough: logging out and back into the same account would
 * produce the same pair, and work started before the logout would then look current. The
 * monotonic generation makes every binding distinct, so an A → B → A sequence never admits
 * work that belongs to the first A.
 */
export interface WakeBinding {
  readonly account: string;
  readonly session: string;
  readonly generation: number;
}

export function isCurrentBinding(started: WakeBinding | null, current: WakeBinding | null): boolean {
  return started !== null && current !== null &&
    started.generation === current.generation && started.account === current.account && started.session === current.session;
}

export class WakeBindingRegistry {
  private binding: WakeBinding | null = null;
  private counter = 0;

  get current(): WakeBinding | null {
    return this.binding;
  }

  /** Binds the worker to an account and session. The result is never equal to an earlier one. */
  bind(account: string, session: string): WakeBinding {
    if (!TOKEN.test(account) || !TOKEN.test(session)) throw new TypeError('Invalid wake binding');
    this.counter += 1;
    this.binding = { account, session, generation: this.counter };
    return this.binding;
  }

  /** Logout or account switch: there is no current binding, so no result may be applied. */
  clear(): void {
    this.counter += 1;
    this.binding = null;
  }

  /** True only for the binding in force right now. */
  isCurrent(binding: WakeBinding | null): boolean {
    return isCurrentBinding(binding, this.binding);
  }
}

/**
 * Collapses duplicate wakes into one sync.
 *
 * Several wakes can arrive for one change, and a resume after sleep can deliver a burst. While
 * a sync runs, further wakes set a single pending flag and are covered by one further run,
 * because the sync reads whatever is current rather than replaying per-wake work.
 *
 * Each cycle carries a generation. `dispose` — an account switch, a logout, a new scope —
 * abandons the current cycle, and a run started before it can no longer change this object,
 * so a late success or a late failure cannot disturb a sync that has already started.
 */
export class WakeCoalescer {
  private running = false;
  private pending = false;
  private generation = 0;

  get busy(): boolean {
    return this.running;
  }

  /** Abandons the current cycle; work already in flight becomes unable to affect this object. */
  dispose(): void {
    this.generation += 1;
    this.running = false;
    this.pending = false;
  }

  /**
   * Runs `sync` for this wake and repeats for wakes that arrived while it ran. Returns how many
   * times it ran; 0 means a running cycle already covers this wake. A failure is not swallowed:
   * it is passed to the caller's `waitUntil` after the cycle is cleared.
   */
  async run(sync: () => Promise<void>): Promise<number> {
    if (this.running) {
      this.pending = true;
      return 0;
    }
    this.generation += 1;
    const cycle = this.generation;
    this.running = true;
    this.pending = false;
    let runs = 0;
    try {
      for (;;) {
        runs += 1;
        await sync();
        // A disposed cycle stops here without touching state a newer cycle now owns.
        if (cycle !== this.generation) return runs;
        if (!this.pending) break;
        this.pending = false;
      }
    } catch (error) {
      if (cycle === this.generation) {
        this.running = false;
        this.pending = false;
      }
      throw error;
    }
    this.running = false;
    return runs;
  }
}
