import { isGeneration, isSubscriptionId, toBase64Url } from './contract';
import type { PushSubscriptionKeys } from './contract';
import type { PushScopeIdentity } from './scope';

/**
 * Local record of which server subscription this browser currently owns.
 *
 * It keeps the subscription id, its CAS generation, the opaque account/session identities and
 * a one-way fingerprint of the exact subscription that was registered. The endpoint and the
 * p256dh/auth key material are credential data and are never written to browser storage, logs
 * or test artifacts; the fingerprint is a digest they cannot be recovered from. Without this
 * record a reload could not unregister its own subscription, so it belongs to the product,
 * not to diagnostics.
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
  /**
   * One-way fingerprint of the endpoint, subscription keys and application server key this
   * registration was made with. Null for a record written before fingerprints existed, which
   * therefore proves nothing about the subscription the browser holds now.
   */
  fingerprint: string | null;
}

const SAFE = /^[A-Za-z0-9_-]{1,128}$/;
const FINGERPRINT = /^[A-Za-z0-9_-]{43}$/;

/**
 * Binds one exact subscription to one registration.
 *
 * A push service can replace an endpoint without changing the application server key, so the
 * key alone cannot show that the subscription the browser holds now is the one the server
 * knows under this id. The digest covers the endpoint, both subscription keys and the
 * application server key together, so any of them changing produces a different value, while
 * none of them can be read back out of it.
 */
export async function subscriptionFingerprint(endpoint: string, keys: PushSubscriptionKeys, applicationServerKey: string): Promise<string> {
  const material = `rogichat.push-binding.v1\n${endpoint}\n${keys.p256dh}\n${keys.auth}\n${applicationServerKey}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return toBase64Url(new Uint8Array(digest));
}

export function isFingerprint(value: unknown): value is string {
  return typeof value === 'string' && FINGERPRINT.test(value);
}

export function rememberBinding(storage: BindingStorage, identity: PushScopeIdentity, subscription: { id: string; generation: string; fingerprint: string }): void {
  if (!SAFE.test(identity.account) || !SAFE.test(identity.session) || !isSubscriptionId(subscription.id) || !isGeneration(subscription.generation) ||
    !isFingerprint(subscription.fingerprint)) {
    throw new TypeError('Invalid push binding');
  }
  storage.setItem(PUSH_BINDING_KEY, `v3:${identity.account}:${identity.session}:${subscription.id}:${subscription.generation}:${subscription.fingerprint}`);
}

/**
 * Browser storage is untrusted input: an unreadable or malformed record is simply absent.
 *
 * A record from an earlier format carries no fingerprint. It still identifies state to clear,
 * so it is returned rather than discarded, and nothing may read that absence as proof that the
 * subscription the browser holds now is the registered one.
 */
export function readBinding(storage: BindingStorage): StoredBinding | null {
  const raw = storage.getItem(PUSH_BINDING_KEY);
  if (raw === null) return null;
  const parts = raw.split(':');
  const [version, account, session, id, generation, fingerprint] = parts;
  if (account === undefined || session === undefined || id === undefined || generation === undefined) return null;
  const legacy = (version === 'v1' && parts.length === 5) || (version === 'v2' && parts.length === 6);
  if (!legacy && !(version === 'v3' && parts.length === 6)) return null;
  if (!SAFE.test(account) || !SAFE.test(session) || !isSubscriptionId(id) || !isGeneration(generation)) return null;
  if (version === 'v3' && !isFingerprint(fingerprint)) return null;
  return { account, session, id, generation, fingerprint: version === 'v3' && fingerprint !== undefined ? fingerprint : null };
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
