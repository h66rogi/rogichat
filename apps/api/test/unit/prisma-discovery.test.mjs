import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { setInterval, clearInterval } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
import mysql from 'mysql2';
import { TransactionAdapter, poolOptions } from '../../dist/infrastructure/database/prisma-provider.js';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { sampleEnv, waitFor } from '../helpers.mjs';

const column = { catalog: 'def', schema: '', table: '', orgTable: '', name: 'VERSION()', orgName: '', characterSet: 45, columnLength: 32, columnType: 253, flags: 0, decimals: 0 };

test('authenticated trickling VERSION response has absolute deadline, closes transport and permits recovery/shutdown', { timeout: 9000 }, async t => {
  const server = mysql.createServer(), sockets = new Set(), intervals = new Set();
  let versionRequests = 0, discoveryClosed = false, trickle = true;
  const received = [], errors = [];
  server.on('connection', connection => {
    const socket = connection.stream; sockets.add(socket);
    socket.on('close', () => { sockets.delete(socket); }); connection.on('error', error => { errors.push(error.message); });
    connection.serverHandshake({ protocolVersion: 10, serverVersion: '8.0.44', connectionId: sockets.size, statusFlags: 2, characterSet: 45, capabilityFlags: 0x0008820d, authCallback: (_input, callback) => { received.push('AUTHENTICATED'); callback(null); connection.sequenceId = 0; } });
    connection.on('packet', () => { connection.sequenceId = 0; });
    // mysql2 server routes text SET commands through its stmt_prepare event.
    connection.on('stmt_prepare', sql => { received.push(sql); connection.writeOk(); });
    connection.on('query', sql => {
      received.push(sql);
      if (sql === 'SELECT VERSION()') {
        versionRequests++;
        connection.writeColumns([column]);
        if (!trickle) { connection.writeTextRow(['8.0.44']); connection.writeEof(); return; }
        // Valid result header, then a row packet whose body never finishes.
        // Traffic every 50ms defeats a 3s idle timeout but not an absolute one.
        socket.write(Buffer.from([0, 16, 0, 4]));
        const timer = setInterval(() => { if (!socket.destroyed) socket.write(Buffer.from([0])); }, 50);
        intervals.add(timer);
        socket.once('close', () => { discoveryClosed = true; clearInterval(timer); intervals.delete(timer); });
      } else if (sql === 'SELECT 1') {
        connection.writeColumns([{ ...column, name: 'one' }]); connection.writeTextRow(['1']); connection.writeEof();
      } else connection.writeOk();
    });
  });
  server.listen(0, '127.0.0.1'); await once(server._server, 'listening');
  t.after(async () => { for (const timer of intervals) clearInterval(timer); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  const context = new AsyncLocalStorage();
  const options = poolOptions(readConfig('api', { ...sampleEnv, DB_POOL_SIZE: '1', DATABASE_URL: `mysql://fixture:fixture-only@127.0.0.1:${server._server.address().port}/rogichat_test` }, []));
  options.logger = { error: error => { errors.push(error.message); } };
  const factory = new TransactionAdapter(options, context);
  // Simulate the first readiness caller expiring while connect is shared.
  const first = { writable: false, closed: true, commitStarted: false, rollbackConfirmed: false };
  const started = performance.now();
  const adapter = await context.run(first, () => factory.connect());
  t.after(() => adapter.dispose());
  assert.equal(versionRequests, 1, JSON.stringify({ received, errors })); assert.ok(performance.now() - started < 4000);
  await waitFor(() => discoveryClosed, 500);
  const pool = adapter.underlyingDriver();
  const active = { writable: true, closed: false, commitStarted: false, rollbackConfirmed: false };
  await context.run(active, async () => {
    const connection = await pool.getConnection();
    try { assert.equal((await connection.query('SELECT 1'))[0].one, '1'); }
    finally { await connection.release(); }
  });
  await assert.rejects(pool.query('SELECT 1'), /transaction_required/);
  await assert.rejects(pool.execute('SELECT 1'), /transaction_required/);
  const closing = performance.now(); await adapter.dispose();
  assert.ok(performance.now() - closing < 1000);
  await delay(20); assert.equal(sockets.size, 0);
  trickle = false;
  const healthy = await new TransactionAdapter(options, context).connect();
  try { assert.equal(healthy.getConnectionInfo().supportsRelationJoins, true); }
  finally { await healthy.dispose(); }
});
