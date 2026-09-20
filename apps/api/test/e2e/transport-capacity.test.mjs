import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { once } from 'node:events';
import { createApi } from '../../dist/application.js';
import { SafeLogger } from '../../dist/infrastructure/observability/logging.js';
import { HTTP_CONNECTION_LIMIT, REALTIME_CONNECTION_LIMIT } from '../../dist/common/http/connection-budget.js';
import { waitFor } from '../helpers.mjs';

// Real upgraded TCP sockets exercise Node's shared transport accounting. This
// isolates the reproduced HTTP ceiling from DB admission and Socket.IO load.
test('configured API retains fresh health requests at the realtime socket ceiling and still enforces a finite total', { timeout: 30000 }, async t => {
  const database = { check: async () => ({ ready: true, reason: 'ready' }), close: async () => {} };
  const app = await createApi(database, new SafeLogger('api', () => {}));
  const server = app.getHttpServer(), clients = [], peers = new Set();
  // Test-only upgrade protocol; no fixture route or adapter enters the app source.
  server.on('upgrade', (_req, socket) => {
    peers.add(socket); socket.once('close', () => peers.delete(socket));
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: fixture-transport\r\n\r\n');
  });
  t.after(async () => {
    for (const socket of clients) socket.destroy();
    for (const socket of peers) socket.destroy();
    await app.close();
  });
  await app.listen(0, '127.0.0.1');
  const endpoint = { hostname: '127.0.0.1', port: server.address().port, agent: false };
  const count = () => new Promise((resolve, reject) => server.getConnections((error, value) => error ? reject(error) : resolve(value)));
  const upgrade = () => new Promise((resolve, reject) => {
    const req = request({ ...endpoint, path: '/fixture-transport', headers: { Connection: 'Upgrade', Upgrade: 'fixture-transport' } });
    req.once('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('fixture_upgrade_timeout')));
    req.once('upgrade', (_response, socket) => { socket.setTimeout(0); clients.push(socket); resolve(); });
    req.end();
  });
  const health = path => new Promise((resolve, reject) => {
    const req = request({ ...endpoint, path }, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; });
      response.once('end', () => resolve({ status: response.statusCode, body }));
      response.once('error', reject);
    });
    req.once('error', reject); req.setTimeout(5000, () => req.destroy(new Error('fixture_http_timeout'))); req.end();
  });
  for (let offset = 0; offset < REALTIME_CONNECTION_LIMIT; offset += 32) {
    await Promise.all(Array.from({ length: Math.min(32, REALTIME_CONNECTION_LIMIT - offset) }, upgrade));
  }
  await waitFor(async () => await count() === REALTIME_CONNECTION_LIMIT);
  assert.deepEqual(await health('/live'), { status: 200, body: '{"status":"ok"}' });
  assert.deepEqual(await health('/ready'), { status: 200, body: '{"status":"ready"}' });
  await waitFor(async () => await count() === REALTIME_CONNECTION_LIMIT);
  for (let index = REALTIME_CONNECTION_LIMIT; index < HTTP_CONNECTION_LIMIT; index++) await upgrade();
  assert.equal(await count(), HTTP_CONNECTION_LIMIT);
  const dropped = once(server, 'drop');
  await assert.rejects(health('/ready'), error => error.code === 'ECONNRESET');
  await dropped;
  assert.equal(await count(), HTTP_CONNECTION_LIMIT);
  clients.pop().destroy();
  await waitFor(async () => await count() === HTTP_CONNECTION_LIMIT - 1);
  assert.deepEqual(await health('/ready'), { status: 200, body: '{"status":"ready"}' });
});
