import { isGeneration, isSubscriptionId } from './contract';
import type { PushScopeIdentity } from './scope';

/**
 * Local record of which server subscription this browser currently owns.
 *
 * Only the subscription id, its CAS generation and the opaque account/session identities are
 * kept. The endpoint and the p256dh/auth key material are credential data and are never
 * written to browser storage, logs or test artifacts. Without this record a reload could not
 * unregister its own subscription, so the record belongs to the product, not to diagnostics.
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
}

const SAFE = /^[A-Za-z0-9_-]{1,128}$/;

export function rememberBinding(storage: BindingStorage, identity: PushScopeIdentity, subscription: { id: string; generation: string }): void {
  if (!SAFE.test(identity.account) || !SAFE.test(identity.session) || !isSubscriptionId(subscription.id) || !isGeneration(subscription.generation)) {
    throw new TypeError('Invalid push binding');
  }
  storage.setItem(PUSH_BINDING_KEY, `v1:${identity.account}:${identity.session}:${subscription.id}:${subscription.generation}`);
}

/** Browser storage is untrusted input: an unreadable or malformed record is simply absent. */
export function readBinding(storage: BindingStorage): StoredBinding | null {
  const raw = storage.getItem(PUSH_BINDING_KEY);
  if (raw === null) return null;
  const parts = raw.split(':');
  const [version, account, session, id, generation] = parts;
  if (parts.length !== 5 || version !== 'v1' || account === undefined || session === undefined || id === undefined || generation === undefined) return null;
  if (!SAFE.test(account) || !SAFE.test(session) || !isSubscriptionId(id) || !isGeneration(generation)) return null;
  return { account, session, id, generation };
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
