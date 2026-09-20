import { WakeCoalescer, isCurrentBinding } from './wake';
import type { WakeBinding } from './wake';

/**
 * The page side of a wake.
 *
 * The service worker never reads private data: it shows the generic notification and tells any
 * open page that something may have changed. This bridge is what receives that, and it also
 * syncs when the app is opened or resumed, which is what covers every wake delivered while no
 * page was running.
 *
 * The sync itself belongs to the app. The bridge only decides when to run it, collapses a
 * burst into one run, and refuses anything that arrived for a different account or session.
 */
export const WAKE_BIND = 'rogichat.push.bind';
export const WAKE_UNBIND = 'rogichat.push.unbind';
export const WAKE_SYNC = 'rogichat.push.sync';

export interface WakeWorkerPort {
  readonly controller: { postMessage(message: unknown): void } | null;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

export interface WakeBridgeOptions {
  /** The account and session this page is signed in as. */
  binding: WakeBinding;
  /** Authenticated sync, owned by the app. It must reauthenticate and reauthorize. */
  sync: () => Promise<void>;
  worker: WakeWorkerPort | null;
  /** Emits `visibilitychange` and `focus`; the page's window. */
  resume: EventTarget | null;
  /** Whether the page is currently visible. */
  visible: () => boolean;
}

/** Binds the worker to this account and syncs on wake, open and resume. Returns a stop function. */
export function startWakeBridge({ binding, sync, worker, resume, visible }: WakeBridgeOptions): () => void {
  const coalescer = new WakeCoalescer();
  const run = (): void => {
    void coalescer.run(sync).catch(() => {
      // The app reports its own sync failure; the bridge only decides when to run it, and a
      // failed run must not stop later wakes from starting a new one.
    });
  };

  const onMessage = (event: { data: unknown }): void => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    const { type, account, session, generation } = message as Record<string, unknown>;
    if (type !== WAKE_SYNC) return;
    // A wake for an account or session this page is not signed in as is not ours to act on.
    if (!isCurrentBinding(readBinding(account, session, generation), binding)) return;
    run();
  };

  worker?.addEventListener('message', onMessage);
  worker?.controller?.postMessage({ type: WAKE_BIND, account: binding.account, session: binding.session, generation: binding.generation });

  const onResume = (): void => {
    if (visible()) run();
  };
  resume?.addEventListener('visibilitychange', onResume);
  resume?.addEventListener('focus', onResume);

  // A wake delivered while no page was running is covered by this first sync.
  if (visible()) run();

  return () => {
    worker?.removeEventListener('message', onMessage);
    resume?.removeEventListener('visibilitychange', onResume);
    resume?.removeEventListener('focus', onResume);
    worker?.controller?.postMessage({ type: WAKE_UNBIND });
    // Abandons the running cycle so a late completion cannot disturb the next account's page.
    coalescer.dispose();
  };
}

function readBinding(account: unknown, session: unknown, generation: unknown): WakeBinding | null {
  return typeof account === 'string' && typeof session === 'string' && Number.isInteger(generation)
    ? { account, session, generation: generation as number }
    : null;
}
