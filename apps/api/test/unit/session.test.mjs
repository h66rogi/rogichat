import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { digest } from '../../dist/modules/auth/auth-primitives.js';
import * as compatibility from '../../dist/modules/auth/auth-primitives.js';
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
  assert.deepEqual(f.calls[0], ['find', f.tx, digest(token), audience, { transport: 'WEB' }]);
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

test('SessionRepository uses same-handle ORM reads/writes, DB clock and command locking', async () => {
  const calls = []; const repository = new SessionRepository(); const now = new Date('2026-09-20T00:00:00.123Z');
  const row = { id: randomUUID(), user_id: randomUUID(), csrf_digest: new Uint8Array(digest(proof)), user: { status: 'ACTIVE', soop: { status: 'VERIFIED' } } };
  const tx = { writable: false, now: async () => now, rows: async (...args) => { calls.push(['raw', ...args]); return [{ id: row.id }]; }, prisma: { auth_sessions: {
    findFirst: async input => { calls.push(['find', input]); return row; },
    create: async input => { calls.push(['create', input]); return { id: input.data.id }; },
    updateMany: async input => { calls.push(['update', input]); return { count: 1 }; },
  } } };
  assert.deepEqual(await repository.findCurrent(tx, digest(token), audience), { id: row.id, user_id: row.user_id, csrf_digest: digest(proof), status: 'ACTIVE', soop_status: 'VERIFIED' });
  assert.deepEqual(calls[0][1].where, { token_digest: new Uint8Array(digest(token)), audience, transport: 'WEB', client_id: null, revoked_at: null, expires_at: { gt: now } });
  tx.writable = true; await repository.findCurrent(tx, digest(token), audience);
  assert.match(calls[1][1], /s\.transport=\? AND s\.client_id <=> \?/);
  assert.match(calls[1][1], /FOR UPDATE$/); assert.deepEqual(calls[1][2], [digest(token), audience, 'WEB', null]);
  const input = { id: randomUUID(), userId: row.user_id, tokenDigest: digest(token), csrfDigest: digest(proof), audience };
  await repository.insert(tx, input);
  assert.equal(calls[2][1].data.expires_at.getTime() - now.getTime(), 7 * 86400000);
  assert.equal(calls[2][1].data.transport, 'WEB'); assert.equal(calls[2][1].data.client_id, null);
  assert.deepEqual(calls[2][1].select, { id: true });
  await repository.revoke(tx, input.id);
  assert.deepEqual(calls[3], ['update', { where: { id: input.id }, data: { revoked_at: now } }]);
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
