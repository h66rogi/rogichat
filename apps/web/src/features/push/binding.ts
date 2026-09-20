import { isApplicationServerKey, isGeneration, isSubscriptionId } from './contract';
import type { PushScopeIdentity } from './scope';

/**
 * Local record of which server subscription this browser currently owns.
 *
 * Only the subscription id, its CAS generation, the public application server key it was
 * registered with and the opaque account/session identities are kept. The endpoint and the
 * p256dh/auth key material are credential data and are never written to browser storage, logs
 * or test artifacts. Without this record a reload could not unregister its own subscription,
 * so the record belongs to the product, not to diagnostics.
 */
export const PUSH_BINDING_KEY = 'rogichat.push-binding';

export interface BindingStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StoredBinding {
  account: string;
  session: string;
  id: string;
  generation: string;
  /** The application server key this browser registered with; null for a record without it. */
  applicationServerKey: string | null;
}

const SAFE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Records the registration, including the application server key it was made with.
 *
 * That key is the server's public VAPID key, not credential material, and it is the only
 * evidence a browser that hides `applicationServerKey` leaves behind. Without it a later read
 * cannot tell a current subscription from one made before a key rotation.
 */
export function rememberBinding(storage: BindingStorage, identity: PushScopeIdentity, subscription: { id: string; generation: string; applicationServerKey: string }): void {
  if (!SAFE.test(identity.account) || !SAFE.test(identity.session) || !isSubscriptionId(subscription.id) || !isGeneration(subscription.generation) ||
    !isApplicationServerKey(subscription.applicationServerKey)) {
    throw new TypeError('Invalid push binding');
  }
  storage.setItem(PUSH_BINDING_KEY, `v2:${identity.account}:${identity.session}:${subscription.id}:${subscription.generation}:${subscription.applicationServerKey}`);
}

/**
 * Browser storage is untrusted input: an unreadable or malformed record is simply absent.
 *
 * A `v1` record predates the recorded key. It still identifies state to clear, so it is
 * returned with no key evidence rather than discarded; nothing may treat that absence as
 * agreement with the server's current key.
 */
export function readBinding(storage: BindingStorage): StoredBinding | null {
  const raw = storage.getItem(PUSH_BINDING_KEY);
  if (raw === null) return null;
  const parts = raw.split(':');
  const [version, account, session, id, generation, applicationServerKey] = parts;
  if (account === undefined || session === undefined || id === undefined || generation === undefined) return null;
  if (!(version === 'v1' && parts.length === 5) && !(version === 'v2' && parts.length === 6)) return null;
  if (!SAFE.test(account) || !SAFE.test(session) || !isSubscriptionId(id) || !isGeneration(generation)) return null;
  if (version === 'v2' && !isApplicationServerKey(applicationServerKey)) return null;
  return { account, session, id, generation, applicationServerKey: version === 'v2' && applicationServerKey !== undefined ? applicationServerKey : null };
}

/**
 * The binding for the current account only. A record from another account is never reused for
 * registration or removal: the server answers NOT_FOUND for a cross-account endpoint even after
 * it was withdrawn, so an account switch has to unsubscribe and obtain a fresh endpoint first.
 */
export function readAccountBinding(storage: BindingStorage, identity: PushScopeIdentity): StoredBinding | null {
  const stored = readBinding(storage);
  return stored && stored.account === identity.account ? stored : null;
}

export function forgetBinding(storage: BindingStorage): void {
  storage.removeItem(PUSH_BINDING_KEY);
}
