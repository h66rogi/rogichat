import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, chmod, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RestoreIsolationClient } from '../../dist/modules/restore-gate/restore-isolation.client.js';

async function fixture(t, handler) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'rg-ipc-'))), path = join(directory, 's');
  await chmod(directory, 0o700);
  const sockets = new Set();
  const server = createServer(socket => { sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket)); handler(socket); }); server.listen(path); await once(server, 'listening'); await chmod(path, 0o600);
  const close = async () => { for (const socket of sockets) socket.destroy(); if (server.listening) await new Promise(resolve => server.close(resolve)); };
  t.after(async () => { await close(); await rm(directory, { recursive: true, force: true }); });
  return { path, directory, server, close };
}
test('custody IPC absolute deadline defeats active slow trickle', { timeout: 6000 }, async t => {
  const f = await fixture(t, socket => {
    socket.on('error', () => {});
    const timer = setInterval(() => socket.write(' '), 50); socket.on('close', () => clearInterval(timer));
  });
  const client = new RestoreIsolationClient(f.path, { isolation() { assert.fail('trickle is not a proof'); } });
  const began = performance.now();
  await assert.rejects(client.assertHeld({}, { sha256: 'a'.repeat(64) }));
  const elapsed = performance.now() - began; assert.ok(elapsed >= 2900 && elapsed < 5000);
});
test('closed, oversized and permissive custody sockets fail closed', { timeout: 6000 }, async t => {
  const f = await fixture(t, socket => socket.end('x'.repeat(17000)));
  const client = new RestoreIsolationClient(f.path, { isolation() { assert.fail('oversize is not a proof'); } });
  await assert.rejects(client.assertHeld({}, { sha256: 'a'.repeat(64) }));
  await chmod(f.path, 0o666); await assert.rejects(client.assertHeld({}, { sha256: 'a'.repeat(64) }));
  await chmod(f.path, 0o600); await f.close();
  await assert.rejects(client.assertHeld({}, { sha256: 'a'.repeat(64) }));
});
