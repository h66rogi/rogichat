import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { once } from 'node:events';
import { createConnection } from 'node:net';
import { runDecoderChild } from '../../dist/isolated/media-decoder/decoder-child.js';
import { decoderServer } from '../../dist/isolated/media-decoder/media-decoder-server.js';
import { frame } from '../../dist/common/media/media-decoder-protocol.js';

const supported = ['linux', 'darwin'].includes(process.platform);
async function until(predicate) {
  for (let i = 0; i < 300; i++) { if (await predicate()) return; await delay(10); }
  assert.fail('process did not terminate within bound');
}
function terminated(pid) {
  try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return true; throw error; }
  // Linux can expose a killed orphan zombie until init reaps it: it cannot execute.
  const status = childProcess.spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
  return status.stdout.trim().startsWith('Z');
}
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'rg-group-')); const pidPath = join(dir, 'pid');
  t.after(async () => {
    try { const pid = Number(await readFile(pidPath, 'utf8')); if (pid > 0 && !terminated(pid)) process.kill(pid, 'SIGKILL'); } catch { /* Cleanup tolerates an already absent synthetic process. */ }
    await rm(dir, { recursive: true, force: true });
  });
  const script = mode => `
    const {spawn} = require('node:child_process');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'inherit'});
    require('node:fs').writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));
    ${mode === 'exit' ? 'process.exit(1)' : mode === 'overflow' ? "process.stdout.write('x'.repeat(1025)); setInterval(() => {}, 1000)" : 'setInterval(() => {}, 1000)'};
  `;
  const pid = async () => { await until(async () => { try { return Number(await readFile(pidPath, 'utf8')) > 0; } catch { return false; } }); return Number(await readFile(pidPath, 'utf8')); };
  return { dir, script, pid };
}

test('POSIX hard deadline, abort, leader exit and stdout overflow kill real grandchild and await close', { skip: !supported }, async t => {
  for (const mode of ['timeout', 'abort', 'exit', 'overflow']) {
    const f = await setup(t); const controller = new globalThis.AbortController();
    const pending = assert.rejects(runDecoderChild(['-e', f.script(mode)], controller.signal, mode === 'timeout' ? 500 : 5000));
    const pid = await f.pid(); if (mode === 'abort') controller.abort();
    await pending; await until(() => terminated(pid)); assert.equal(terminated(pid), true);
  }
});

test('already aborted and spawn-error paths fail without signaling zero or an unrelated group', { skip: !supported }, async t => {
  await assert.rejects(runDecoderChild(['-e', 'process.exit(0)'], AbortSignal.abort(), 500));
  const original = childProcess.spawn;
  const replacement = mock.method(childProcess, 'spawn', (_command, args, options) => original('/nonexistent-decoder-test-node', args, options));
  syncBuiltinESMExports(); t.after(() => { replacement.mock.restore(); syncBuiltinESMExports(); });
  await assert.rejects(runDecoderChild([], AbortSignal.timeout(1000), 500));
});

test('socket close, socket error and server shutdown terminate grandchildren before scratch cleanup completes', { skip: !supported }, async t => {
  for (const mode of ['close', 'error', 'shutdown']) {
    const f = await setup(t); const original = childProcess.spawn;
    const replacement = mock.method(childProcess, 'spawn', (command, args, options) => original(command, ['-e', f.script('hang')], options));
    syncBuiltinESMExports();
    const server = decoderServer(f.dir); const path = join(f.dir, 's');
    server.listen(path); await once(server, 'listening');
    const socket = createConnection({ path, allowHalfOpen: true }); socket.on('error', () => {}); await once(socket, 'connect');
    try {
      socket.write(Buffer.concat([frame({ version: 1, intent: { kind: 'PHOTO', contentType: 'image/png', byteLength: 3 } }), Buffer.from('123')]));
      const pid = await f.pid();
      if (mode === 'shutdown') await new Promise(resolve => server.close(resolve));
      else socket.destroy(mode === 'error' ? new Error('synthetic socket error') : undefined);
      await until(() => terminated(pid));
      await until(async () => (await readdir(f.dir)).every(name => !name.startsWith('output-') && !name.startsWith('rogichat-upload-')));
    } finally {
      socket.destroy(); if (server.listening) await new Promise(resolve => server.close(resolve));
      replacement.mock.restore(); syncBuiltinESMExports();
    }
  }
});

test('stdout error and premature close races kill the captured group and settle only after child close', { skip: !supported }, async t => {
  for (const mode of ['error', 'close']) {
    const f = await setup(t); const original = childProcess.spawn; let processHandle; let closed = false;
    const replacement = mock.method(childProcess, 'spawn', (...args) => {
      processHandle = original(...args); processHandle.once('close', () => { closed = true; }); return processHandle;
    });
    syncBuiltinESMExports();
    try {
      const pending = assert.rejects(runDecoderChild(['-e', f.script('hang')], AbortSignal.timeout(3000), 3000));
      const pid = await f.pid(); processHandle.stdout.destroy(mode === 'error' ? new Error('synthetic pipe error') : undefined);
      await pending; assert.equal(closed, true); await until(() => terminated(pid));
    } finally { replacement.mock.restore(); syncBuiltinESMExports(); }
  }
});
