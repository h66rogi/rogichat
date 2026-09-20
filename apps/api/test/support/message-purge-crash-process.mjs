import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export function requirePurgeCrashDatabase(env = process.env) {
  if (env.ROGICHAT_TEST_MYSQL !== 'disposable' || env.APP_ENV !== 'test' || env.NODE_ENV !== 'test' || env.DB_TLS_MODE !== 'disabled') {
    throw new Error('purge_crash_requires_disposable_test');
  }
  let url;
  try { url = new URL(env.DATABASE_URL); } catch { throw new Error('purge_crash_requires_loopback_fixture'); }
  const suffix = /^\/rogichat_test_([a-f0-9]{16})$/.exec(url.pathname)?.[1];
  if (url.protocol !== 'mysql:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !url.port ||
      !suffix || url.username !== `fixture_${suffix}` || !url.password || url.search || url.hash) {
    throw new Error('purge_crash_requires_loopback_fixture');
  }
}

/** Only owned test processes; no shell, inherited admin URL or application secrets. */
export function purgeCrashChild() {
  requirePurgeCrashDatabase();
  const proc = fork(new URL('./message-purge-crash-child.mjs', import.meta.url), [], {
    execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { PATH: process.env.PATH, APP_ENV: 'test', NODE_ENV: 'test', DB_TLS_MODE: 'disabled',
      ROGICHAT_TEST_MYSQL: 'disposable', DATABASE_URL: process.env.DATABASE_URL },
  });
  const frames = []; let output = '', failure = false, exit;
  let resolveExit;
  const exited = new Promise(resolve => { resolveExit = resolve; });
  const fail = () => { failure = true; proc.kill('SIGKILL'); };
  proc.once('error', () => { failure = true; exit = { code: null, signal: null }; resolveExit(exit); });
  proc.once('exit', (code, signal) => { exit = { code, signal }; resolveExit(exit); });
  for (const stream of [proc.stdout, proc.stderr]) stream.on('data', bytes => {
    if (Buffer.byteLength(output) + bytes.length > 4096) { fail(); return; }
    output += bytes.toString('utf8');
  });
  proc.on('message', frame => {
    if (!frame || typeof frame !== 'object' || JSON.stringify(frame).length > 1024 || frames.length >= 4 ||
        !['ready', 'pre-commit', 'post-commit', 'result', 'failed'].includes(frame.type)) { fail(); return; }
    if (frame.type === 'failed') failure = true;
    frames.push(frame);
  });
  async function wait(type, timeout = 6000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (failure) throw new Error('purge_crash_child_failed');
      const frame = frames.find(value => value.type === type);
      if (frame) return frame;
      if (exit) throw new Error('purge_crash_child_exited_before_barrier');
      await delay(10);
    }
    throw new Error('purge_crash_child_barrier_timeout');
  }
  async function waitExit() {
    let timer;
    try { return await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('purge_crash_child_exit_timeout')), 4000); })]); }
    finally { clearTimeout(timer); }
  }
  return {
    async start(mode, lease) {
      await wait('ready');
      await new Promise((resolve, reject) => proc.send({ mode, lease: { ...lease, generation: String(lease.generation) } }, error => error ? reject(new Error('purge_crash_child_ipc_failed')) : resolve()));
    },
    wait, waitExit,
    kill() {
      assert.equal(failure, false, 'child must not fail before injected death');
      assert.equal(exit, undefined, 'child must still be alive before injected death');
      assert.equal(proc.exitCode, null); assert.equal(proc.signalCode, null);
      assert.equal(proc.kill('SIGKILL'), true);
    },
    async stop() { if (!exit) proc.kill('SIGKILL'); await waitExit(); },
    assertSilent() { assert.equal(output.length, 0, 'fixture child must not log credentials, identifiers or message bodies'); },
    hasResult() { return frames.some(frame => frame.type === 'result'); },
  };
}
