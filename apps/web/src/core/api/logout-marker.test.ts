import assert from 'node:assert/strict';
import test from 'node:test';
import { beginLogout, logoutCleanup, clearLogout, markerMatchesBinding, LOGOUT_PENDING } from './logout-marker';
import { sessionBinding } from './session-binding';
void test('pending marker stores only one-way session equality binding', async () => {
  const binding = await sessionBinding('synthetic-csrf-session-A');
  assert.match(binding, /^[a-f0-9]{64}$/);
  assert.notEqual(binding, await sessionBinding('synthetic-csrf-session-B'));
  assert.equal(binding, await sessionBinding('synthetic-csrf-session-A'));
});
void test('new sessions and late logout completions cannot clear or revoke newer pending intent', () => {
  const map = new Map<string, string>();
  const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } };
  const old = beginLogout(storage, 'hash-A', 'attempt-1');
  assert.equal(markerMatchesBinding(old, 'hash-B'), false);
  assert.equal(markerMatchesBinding(old, 'hash-A'), true);
  const current = beginLogout(storage, 'hash-B', 'attempt-2');
  assert.equal(clearLogout(storage, old), false);
  assert.equal(storage.getItem(LOGOUT_PENDING), current);
  assert.equal(clearLogout(storage, current), true);
  assert.equal(storage.getItem(LOGOUT_PENDING), null);
});

void test('logout cleanup metadata contains only a scoped digest and retains exact marker compare', () => {
  const map = new Map<string, string>();
  const store = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } };
  const marker = beginLogout(store, 'binding', 'nonce', { environment: 'qa', sessionKey: 'a'.repeat(64) });
  assert.deepEqual(logoutCleanup(marker), { environment: 'qa', sessionKey: 'a'.repeat(64) });
  assert.equal(logoutCleanup('v1:binding:nonce'), null);
  assert.throws(() => logoutCleanup('v1:binding:nonce:qa:raw-token'));
  assert.throws(() => logoutCleanup('v1:binding:nonce:other:' + 'a'.repeat(64)));
});
