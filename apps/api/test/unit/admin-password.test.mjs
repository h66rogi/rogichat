import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, open, chmod, link, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PasswordHasher } from '../../dist/modules/auth/password/password-hasher.js';
import { passwordValue, passwordLogin, passwordChange } from '../../dist/modules/auth/password/password.dto.js';
import { issueGrant, revokeGrant } from '../../dist/modules/admin/admin.dto.js';
import { adminBootstrapRequest, readAdminBootstrapRequest } from '../../dist/modules/admin/admin-bootstrap.request.js';

test('password input preserves Unicode and whitespace while rejecting controls, malformed UTF-8 and injection', () => {
  const password = '  twelve words unchanged  ';
  assert.equal(passwordValue(password), password);
  assert.equal(passwordValue('가'.repeat(12)), '가'.repeat(12));
  for (const value of [undefined, null, 12, 'short', '가'.repeat(86), 'x'.repeat(257), 'long-password\u0000', 'long-password\n', 'long-password\u007f', 'long-password\ud800']) assert.throws(() => passwordValue(value));
  const input = { clientId: 'web', loginId: 'Review.ID-42', password, termsVersion: '2026-09-20' };
  assert.equal(passwordLogin(input).loginId, 'review.id-42');
  for (const extra of [{ role: 'STREAMER' }, { clientId: 'WEB' }, { loginId: ' review' }, { loginId: 'éxample' }, { termsVersion: 'old' }]) assert.throws(() => passwordLogin({ ...input, ...extra }));
  assert.throws(() => passwordChange({ clientId: 'ios', currentPassword: password, newPassword: password, userId: randomUUID() }));
});

test('scrypt uses randomized strict hashes, dummy verification and bounded asynchronous admission', async () => {
  const hasher = new PasswordHasher(), password = 'isolated password value';
  const first = hasher.hash(password), second = hasher.hash(password);
  await assert.rejects(hasher.hash(password), error => error.code === 'AUTH_UNAVAILABLE');
  const hashes = await Promise.all([first, second]); assert.notEqual(hashes[0], hashes[1]);
  assert.match(hashes[0], /^scrypt-v1\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{64}$/);
  assert.equal(await hasher.verify(password, hashes[0]), true);
  assert.equal(await hasher.verify(password + '!', hashes[0]), false);
  for (const encoded of [undefined, 'invalid', hashes[0].replace('32768', '1073741824'), hashes[0] + '$extra']) assert.equal(await hasher.verify(password, encoded), false);
});

test('delegation inputs are self-only, bounded and exact; no requested permanent role or owner', () => {
  const input = { requestId: randomUUID(), durationSeconds: 60, reason: '운영 검사' };
  assert.deepEqual(issueGrant(input), input);
  for (const durationSeconds of [0, 59, 3601, 60.1, '60', null]) assert.throws(() => issueGrant({ ...input, durationSeconds }));
  for (const reason of ['', '  ', 'x'.repeat(201), 'line\nvalue']) assert.throws(() => issueGrant({ ...input, reason }));
  for (const field of ['userId', 'actorId', 'role', 'expiresAt', 'owner']) assert.throws(() => issueGrant({ ...input, [field]: randomUUID() }));
  assert.throws(() => revokeGrant({ reason: 'done', userId: randomUUID() }));
});

test('operator request is strict, environment-bound and read only from protected single-link regular fd', async t => {
  const input = { version: 1, environment: 'qa', scope: 'ADMIN_TEST_ACCESS', requestId: randomUUID(), operatorUserId: randomUUID(), expectedSubject: 'isolated_operator' };
  assert.equal(adminBootstrapRequest(input).scope, 'ADMIN_TEST_ACCESS');
  for (const patch of [{ environment: 'test' }, { expectedSubject: '' }, { expectedSubject: 'bad/id' }, { targetUserId: randomUUID() }, { password: 'not permitted' }, { role: 'STREAMER' }]) assert.throws(() => adminBootstrapRequest({ ...input, ...patch }));
  const directory = await mkdtemp(join(tmpdir(), 'rogichat-admin-input-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'request.json'); await writeFile(file, JSON.stringify(input), { mode: 0o600 });
  const read = async () => { const handle = await open(file); try { return readAdminBootstrapRequest(handle.fd); } finally { await handle.close(); } };
  assert.deepEqual(await read(), adminBootstrapRequest(input));
  await chmod(file, 0o640); await assert.rejects(read(), /invalid_admin_request_file/);
  await chmod(file, 0o600); await link(file, join(directory, 'alias')); await assert.rejects(read(), /invalid_admin_request_file/);
});
