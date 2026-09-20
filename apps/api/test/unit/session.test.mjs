import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { Sessions, digest } from '../../dist/auth-core.js';
import * as compatibility from '../../dist/auth-core.js';
import * as primitives from '../../dist/modules/auth/auth-primitives.js';

const token = 'a'.repeat(43); const proof = 'b'.repeat(43);
const audience = 'session-test';
function fixture() {
  const calls = []; const key = randomBytes(32); const tx = Object.freeze({ writable: true });
  let session = { id: randomUUID(), user_id: randomUUID(), csrf_digest: digest(proof), status: 'ACTIVE', soop_status: 'VERIFIED' };
  const repository = {
    findCurrent: async (...args) => { calls.push(['find', ...args]); return session; },
    insert: async (...args) => { calls.push(['insert', ...args]); },
    revoke: async (...args) => { calls.push(['revoke', ...args]); },
  };
  const service = new SessionService(repository, audience, key);
  return { calls, key, tx, service, repository, session, setSession: value => { session = value; } };
}

test('SessionService uses only the explicit repository/transaction and preserves issue HMAC/digest policy', async () => {
  const f = fixture();
  for (const name of ['transactions', 'unitOfWork', 'tx']) assert.equal(name in f.service, false);
  const issued = await f.service.issue(f.tx, f.session.user_id);
  assert.match(issued.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(issued.csrf, createHmac('sha256', f.key).update(`csrf:${audience}:${issued.token}`).digest('base64url'));
  const [operation, tx, stored] = f.calls[0]; assert.equal(operation, 'insert'); assert.equal(tx, f.tx);
  assert.match(stored.id, /^[0-9a-f-]{36}$/); assert.equal(stored.userId, f.session.user_id); assert.equal(stored.audience, audience);
  assert.deepEqual(stored.tokenDigest, digest(issued.token)); assert.deepEqual(stored.csrfDigest, digest(issued.csrf));
  assert.deepEqual(Object.keys(stored).sort(), ['audience', 'csrfDigest', 'id', 'tokenDigest', 'userId']);
});

test('SessionService revalidates account/SOOP/CSRF each call and returns only the minimal principal', async () => {
  const f = fixture();
  const expected = { userId: f.session.user_id, sessionId: f.session.id, soopLinked: true };
  assert.deepEqual(await f.service.require(f.tx, token, proof, true), expected);
  assert.deepEqual(f.calls[0], ['find', f.tx, digest(token), audience]);
  for (const invalid of [undefined, '', 'a'.repeat(42), '+'.repeat(43)]) {
    await assert.rejects(f.service.require(f.tx, invalid), { code: 'UNAUTHENTICATED' });
  }
  assert.equal(f.calls.length, 1);
  await assert.rejects(f.service.require(f.tx, token, 'wrong'), { code: 'FORBIDDEN' });
  f.session.csrf_digest = Buffer.alloc(31);
  await assert.rejects(f.service.require(f.tx, token, proof), { code: 'FORBIDDEN' });
  f.session.csrf_digest = digest(proof);
  for (const soop of [null, 'REVOKED', 'PENDING']) {
    f.session.soop_status = soop;
    assert.equal((await f.service.require(f.tx, token)).soopLinked, false);
    await assert.rejects(f.service.require(f.tx, token, proof, true), { code: 'SOOP_LINK_REQUIRED' });
  }
  f.session.status = 'SUSPENDED'; await assert.rejects(f.service.require(f.tx, token), { code: 'UNAUTHENTICATED' });
  f.setSession(undefined); await assert.rejects(f.service.require(f.tx, token), { code: 'UNAUTHENTICATED' });
});

test('SessionService revocation shares the authenticated command handle and does not revoke on failed proof', async () => {
  const f = fixture(); await f.service.revoke(f.tx, token, proof);
  assert.deepEqual(f.calls.map(call => call[0]), ['find', 'revoke']);
  assert.deepEqual(f.calls[1], ['revoke', f.tx, f.session.id]);
  f.calls.length = 0;
  await assert.rejects(f.service.revoke(f.tx, token, 'wrong'), { code: 'FORBIDDEN' });
  assert.deepEqual(f.calls.map(call => call[0]), ['find']);
});

test('SessionRepository preserves DB-time expiry, audience, joined locking and seven-day lifetime SQL', async () => {
  const calls = []; const row = { id: randomUUID() }; const repository = new SessionRepository();
  const tx = { writable: false, rows: async (...args) => { calls.push(args); return [row]; }, execute: async (...args) => { calls.push(args); } };
  assert.equal(await repository.findCurrent(tx, digest(token), audience), row);
  const [readSql, params] = calls[0];
  assert.match(readSql, /JOIN users u ON u.id=s.user_id LEFT JOIN platform_soop p ON p.user_id=u.id/);
  assert.match(readSql, /s.token_digest=\? AND s.audience=\? AND s.revoked_at IS NULL AND s.expires_at>UTC_TIMESTAMP\(3\)$/);
  assert.deepEqual(params, [digest(token), audience]);
  tx.writable = true; await repository.findCurrent(tx, digest(token), audience);
  assert.equal(calls[1][0], `${readSql} FOR UPDATE`);
  const input = { id: randomUUID(), userId: randomUUID(), tokenDigest: digest(token), csrfDigest: digest(proof), audience };
  await repository.insert(tx, input);
  assert.match(calls[2][0], /TIMESTAMPADD\(DAY,7,UTC_TIMESTAMP\(3\)\)/);
  assert.deepEqual(calls[2][1], [input.id, input.userId, input.tokenDigest, input.csrfDigest, audience]);
  await repository.revoke(tx, input.id);
  assert.deepEqual(calls[3], ['UPDATE auth_sessions SET revoked_at=UTC_TIMESTAMP(3) WHERE id=?', [input.id]]);
});

test('legacy Sessions keeps constructor/caller handles and only logout opens a transaction', async () => {
  const f = fixture(); const scopes = [];
  const transactions = { write: async run => { scopes.push('write'); return run(f.tx); } };
  const sessions = new Sessions(transactions, audience, f.key, f.service);
  assert.equal(sessions.transactions, transactions); assert.equal(sessions.audience, audience);
  await sessions.require(f.tx, token, proof, true); await sessions.issue(f.tx, f.session.user_id);
  assert.deepEqual(scopes, []); assert.equal(sessions.csrf(token), f.service.csrf(token));
  await sessions.logout(token, proof); assert.deepEqual(scopes, ['write']);
  assert.deepEqual(f.calls.at(-1), ['revoke', f.tx, f.session.id]);
  const fallbackCalls = []; const fallbackTx = { writable: true, execute: async (...args) => { fallbackCalls.push(args); } };
  const legacy = new Sessions(transactions, audience, f.key);
  await legacy.issue(fallbackTx, f.session.user_id);
  assert.equal(fallbackCalls.length, 1); assert.match(fallbackCalls[0][0], /^INSERT INTO auth_sessions/);
});

test('session services have no legacy adapter dependency cycle and preserve primitive export identities', async () => {
  for (const symbol of ['ApiError', 'digest', 'secret', 'opaque', 'equalDigest', 'object']) assert.equal(compatibility[symbol], primitives[symbol]);
  for (const name of ['session.service.ts', 'session.repository.ts', 'auth-primitives.ts']) {
    const text = await readFile(new URL(`../../src/modules/auth/${name}`, import.meta.url), 'utf8');
    const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
    for (const node of source.statements) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        assert.ok(!node.moduleSpecifier.text.includes('auth-core'), `${name} must not import the legacy adapter`);
      }
    }
  }
});
