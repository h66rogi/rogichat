import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

export const sampleEnv = {
  APP_ENV: 'test', NODE_ENV: 'test', DB_TLS_MODE: 'disabled',
  DATABASE_URL: 'mysql://fixture:fixture-only@127.0.0.1:13306/rogichat_test',
};

export async function unusedPort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

export function child(role, overrides = {}) {
  const proc = spawn(process.execPath, [`dist/${role === 'api' ? 'main' : 'worker'}.js`], {
    env: { PATH: process.env.PATH, ...sampleEnv, ...overrides }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  for (const stream of [proc.stdout, proc.stderr]) stream.on('data', (chunk) => { output += chunk; });
  const exited = once(proc, 'exit');
  return { proc, exited, output: () => output };
}

export async function waitFor(predicate, milliseconds = 6000) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) {
    if (await predicate()) return;
    await delay(25);
  }
  assert.fail('Timed out waiting for fixture state');
}

export async function stopChild(instance) {
  if (instance.proc.exitCode !== null || instance.proc.signalCode !== null) return;
  instance.proc.kill('SIGTERM');
  const timer = setTimeout(() => instance.proc.kill('SIGKILL'), 11000);
  try { await instance.exited; } finally { clearTimeout(timer); }
}
