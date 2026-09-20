import { newIntentScope } from '../support/membership-scope-fixture.mjs';
import { createUser, createRoom, joinRoom } from '../support/domain-fixture.mjs';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { child, unusedPort, waitFor, stopChild } from '../helpers.mjs';

test('lost client ACK plus actual API SIGKILL is recovered by the same command in a new API process', { timeout: 30000 }, async t => {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const database = new MysqlDatabase(readConfig('api'));
  t.after(() => database.close());
  const directory = await mkdtemp(join(tmpdir(), 'rogi-message-crash-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const key = randomBytes(32);
  const authFile = join(directory, 'fixture-auth.json');
  await writeFile(authFile, JSON.stringify({ key: key.toString('hex') }), { mode: 0o600 });
  const sessions = new SessionService(new SessionRepository(), 'rogi-test', key);
  const fixture = await database.transactions.write(async tx => {
    const user = await createUser(tx, 'crash 합성');
    await tx.execute('INSERT INTO platform_soop (id,user_id,provider_subject,verified_at) VALUES (?,?,?,UTC_TIMESTAMP(3))', [randomUUID(), user, Buffer.from(`fixture-crash-${randomUUID()}`)]);
    const room = await createRoom(tx, 'crash 합성방', 'GROUP');
    await joinRoom(tx, room, user);
    return { user, room, ...await sessions.issue(tx, user) };
  });
  const port = await unusedPort();
  const first = child('api', { DATABASE_URL: process.env.DATABASE_URL, PORT: String(port), AUTH_SECRET_FILE: authFile });
  t.after(() => stopChild(first));
  await waitFor(() => first.output().includes('started'));
  const body = { membershipScope: await database.transactions.read(tx => newIntentScope(tx, key, 'rogi-test', fixture.user, fixture.room)), clientMessageId: randomUUID(), intent: 'SHARED', content: { type: 'TEXT', text: `ACK-loss-${randomUUID()}` } };
  const path = `/v1/rooms/${fixture.room}/messages`;
  const headers = { Origin: 'http://localhost:3001', Cookie: `rogi_session=${fixture.token}`, 'X-CSRF-Token': fixture.csrf, 'Content-Type': 'application/json' };
  let holdResponse;
  let resolveAck, rejectAck;
  const captured = new Promise((resolve, reject) => { resolveAck = resolve; rejectAck = reject; });
  // Egress fault proxy receives the committed ACK but never exposes it to the client.
  // This tests real process death plus lost delivery, not an in-process transaction hook.
  const proxy = createServer((incoming, response) => {
    holdResponse = response;
    const upstream = httpRequest({ hostname: '127.0.0.1', port, path, method: 'POST', headers: incoming.headers }, result => {
      let text = '';
      result.setEncoding('utf8');
      result.on('data', part => { text += part; if (text.length > 8192) result.destroy(new Error('fixture-response-too-large')); });
      result.on('error', rejectAck);
      result.on('end', () => {
        try { assert.equal(result.statusCode, 200); resolveAck(JSON.parse(text)); }
        catch (error) { rejectAck(error); }
      });
    });
    upstream.on('error', rejectAck);
    incoming.pipe(upstream);
  });
  t.after(async () => { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); });
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
  const controller = new globalThis.AbortController();
  t.after(() => controller.abort());
  const client = fetch(`http://127.0.0.1:${proxy.address().port}${path}`, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal })
    .then(() => ({ delivered: true }), () => ({ delivered: false }));
  const ack = await captured;
  assert.equal(ack.status, 'committed');
  const [committed] = await database.transactions.read(tx => tx.rows('SELECT id FROM messages WHERE id=?', [ack.messageId]));
  assert.equal(committed.id, ack.messageId);
  first.proc.kill('SIGKILL');
  const [exitCode, signal] = await first.exited;
  assert.equal(exitCode, null); assert.equal(signal, 'SIGKILL');
  holdResponse.destroy();
  assert.deepEqual(await client, { delivered: false });
  const secondPort = await unusedPort();
  const second = child('api', { DATABASE_URL: process.env.DATABASE_URL, PORT: String(secondPort), AUTH_SECRET_FILE: authFile });
  t.after(() => stopChild(second));
  await waitFor(() => second.output().includes('started'));
  const retry = await fetch(`http://127.0.0.1:${secondPort}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  assert.equal(retry.status, 200); assert.deepEqual(await retry.json(), ack);
  for (const table of ['messages', 'command_receipts', 'room_events', 'jobs']) {
    const [row] = await database.transactions.read(tx => tx.rows(`SELECT COUNT(*) AS total FROM ${table} WHERE room_id=?`, [fixture.room]));
    assert.equal(Number(row.total), 1, table);
  }
  for (const process of [first, second]) {
    assert.ok(!process.output().includes(fixture.token));
    assert.ok(!process.output().includes(body.content.text));
  }
});
