import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout } from 'node:timers';
import { performance } from 'node:perf_hooks';
import { MysqlDatabase, poolOptions } from '../../dist/infrastructure/database/database.js';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { sampleEnv, waitFor } from '../helpers.mjs';

test('driver explicitly verifies certificate chain and hostname, bounds pool and disallows multiple statements', () => {
  const options = poolOptions(readConfig('api', { ...sampleEnv, DB_TLS_MODE: 'required' }, []));
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.equal(typeof options.ssl.checkServerIdentity, 'function');
  assert.equal(options.connectionLimit, 5);
  assert.equal(options.acquireTimeout, 1200);
  assert.equal(options.multipleStatements, false);
  assert.equal(options.timezone, '+00:00');
});

test('unresponsive DB handshake is bounded and simultaneous probes are coalesced', { timeout: 5000 }, async (t) => {
  const sockets = new Set();
  const server = createServer((socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const database = new MysqlDatabase(readConfig('api', { ...sampleEnv, DATABASE_URL: `mysql://fixture:fixture-only@127.0.0.1:${server.address().port}/rogichat_test` }, []));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await database.close();
    await new Promise((resolve) => server.close(resolve));
  });
  const started = performance.now();
  const first = database.check();
  assert.equal(first, database.check());
  assert.deepEqual(await first, { ready: false, reason: 'database_unavailable' });
  assert.ok(performance.now() - started < 2500);
  await database.close();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(sockets.size, 0, 'closed readiness pool must release pending handshake sockets');
});

test('never-used database closes eagerly-created pool and pending handshake without starting Prisma', { timeout: 5000 }, async t => {
  const sockets = new Set();
  const server = createServer(socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const database = new MysqlDatabase(readConfig('api', { ...sampleEnv, DATABASE_URL: `mysql://fixture:fixture-only@127.0.0.1:${server.address().port}/rogichat_test` }, []));
  t.after(async () => { for (const socket of sockets) socket.destroy(); await database.close(); await new Promise(resolve => server.close(resolve)); });
  await waitFor(() => sockets.size > 0, 1000);
  await database.close(); await waitFor(() => sockets.size === 0, 1500);
  assert.deepEqual(await database.check(), { ready: false, reason: 'database_unavailable' });
  await database.close();
});
