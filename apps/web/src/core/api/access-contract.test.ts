import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAccountCapabilities, parseGrants, parseRoomCapabilities } from './access-contract';
import { parseSession, sessionAllowsChat } from './session-contract';
import { ApiClient } from './client';

const base = { authenticated: true, csrfToken: 'synthetic-csrf-session', accountPartition: 'A'.repeat(43), soopLinkStatus: 'REQUIRED' };
void test('server reviewer admission is independent of SOOP linkage and revocation fails closed', () => {
  const reviewer = parseSession({ ...base, onboardingState: 'READY', capabilities: { chat: true } });
  assert.equal(reviewer.soopLinkStatus, 'REQUIRED'); assert.equal(sessionAllowsChat(reviewer), true);
  assert.equal(sessionAllowsChat(parseSession(base)), false);
  assert.equal(sessionAllowsChat(parseSession({ ...base, soopLinkStatus: 'VERIFIED' })), true);
  assert.equal(sessionAllowsChat(parseSession({ ...base, soopLinkStatus: 'VERIFIED', onboardingState: 'SOOP_LINK_REQUIRED', capabilities: { chat: false } })), false);
  assert.throws(() => parseSession({ ...base, capabilities: { chat: true } }));
});
void test('capability parsers reject truthy strings, hidden fields and malformed expiry', () => {
  const account = { chat: true, admin: { enabled: false, manageTestAccess: false, manageReviewers: false }, password: { enabled: true } };
  assert.deepEqual(parseAccountCapabilities(account), account);
  assert.throws(() => parseAccountCapabilities({ ...account, admin: { ...account.admin, enabled: 'true' } }));
  assert.throws(() => parseAccountCapabilities({ ...account, token: 'synthetic' }));
  const room = { effectiveRole: 'FAN', canSendShared: false, canSendToOwner: true, canReadFanInbox: false, canPublish: false, canModerate: false, temporaryStreamer: null };
  assert.deepEqual(parseRoomCapabilities(room), room);
  assert.throws(() => parseRoomCapabilities({ ...room, canPublish: 1 }));
  assert.throws(() => parseRoomCapabilities({ ...room, effectiveRole: 'ADMIN' }));
  assert.throws(() => parseRoomCapabilities({ ...room, temporaryStreamer: { grantId: '11111111-1111-4111-8111-111111111111', expiresAt: 'invalid' } }));
  assert.deepEqual(parseGrants({ grants: [], next: null }), { grants: [], next: null });
  assert.throws(() => parseGrants({ grants: new Array(101).fill({}), next: null }));
  assert.throws(() => parseGrants({ grants: [], next: '/other' }));
});
void test('password login alone permits pre-session POST; password change and grants require CSRF', async () => {
  let calls = 0;
  const api = new ApiClient('https://api.qa.rogi.chat', async (_url, init) => { calls++; assert.equal(init?.credentials, 'include'); return Response.json(base); });
  await api.request('/v1/auth/password/login', { method: 'POST', body: { clientId: 'web', loginId: 'synthetic-reviewer', password: 'isolated-test-only', termsVersion: '2026-09-20' } });
  await assert.rejects(api.request('/v1/auth/password/change', { method: 'POST' }), /Missing CSRF/);
  await assert.rejects(api.request('/v1/admin/rooms/11111111-1111-4111-8111-111111111111/test-grants', { method: 'POST' }), /Missing CSRF/);
  assert.equal(calls, 1);
});
