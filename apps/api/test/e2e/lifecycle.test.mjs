import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const lifecycleUrl = new URL('../../dist/lifecycle.js', import.meta.url).href;
const loggingUrl = new URL('../../dist/logging.js', import.meta.url).href;

async function fixture(t, body, timeout = 3000) {
  const source = `import { installShutdown } from ${JSON.stringify(lifecycleUrl)};
    import { SafeLogger } from ${JSON.stringify(loggingUrl)};
    const state = { draining: false };
    const logger = new SafeLogger('api');
    ${body}`;
  const proc = spawn(process.execPath, ['--input-type=module', '--eval', source], {
    env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', (chunk) => { stdout += chunk; });
  proc.stderr.on('data', (chunk) => { stderr += chunk; });
  const closed = once(proc, 'close');
  const kill = () => { if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL'); };
  t.after(kill);
  const deadline = setTimeout(kill, timeout);
  try {
    const [code, signal] = await closed;
    assert.equal(signal, null, 'fixture must finish without forced termination');
    assert.ok(!`${stdout}${stderr}`.includes('secret-marker'), 'errors must remain redacted through the entire drain');
    assert.equal(stderr, '');
    return { code, events: stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line).event) };
  } finally { clearTimeout(deadline); }
}

for (const fault of [
  "throw new Error('secret-marker')",
  "void Promise.reject(new Error('secret-marker'))",
]) {
  const kind = fault.startsWith('throw') ? 'exception' : 'rejection';
  test(`repeated ${kind}s during drain remain redacted and fail exit`, async (t) => {
    const result = await fixture(t, `
      installShutdown(state, logger, () => new Promise((resolve) => setTimeout(resolve, 80)));
      setTimeout(() => { ${fault}; }, 5);
      setTimeout(() => { ${fault}; }, 20);
    `);
    assert.equal(result.code, 1);
    assert.equal(result.events.filter((event) => event === 'process_fault').length, 2);
    assert.ok(result.events.includes('shutdown_complete'));
  });

  test(`${kind} after SIGTERM changes graceful exit to failure`, async (t) => {
    const result = await fixture(t, `
      installShutdown(state, logger, () => new Promise((resolve) => setTimeout(resolve, 80)));
      process.emit('SIGTERM');
      setTimeout(() => { ${fault}; }, 5);
    `);
    assert.equal(result.code, 1);
    assert.deepEqual(result.events, ['shutdown_started', 'process_fault', 'shutdown_complete']);
  });
}

test('successful drain exits normally without waiting for the deadline', async (t) => {
  const result = await fixture(t, `
    installShutdown(state, logger, async () => {});
    process.emit('SIGTERM');
  `);
  assert.equal(result.code, 0);
  assert.deepEqual(result.events, ['shutdown_started', 'shutdown_complete']);
});

test('synchronous cleanup failure is redacted and exits unsuccessfully', async (t) => {
  const result = await fixture(t, `
    installShutdown(state, logger, () => { throw new Error('secret-marker'); });
    process.emit('SIGTERM');
  `);
  assert.equal(result.code, 1);
  assert.deepEqual(result.events, ['shutdown_started', 'shutdown_failed']);
});

test('leftover handles cannot outlive the shutdown deadline after cleanup resolves', { timeout: 15000 }, async (t) => {
  const result = await fixture(t, `
    setInterval(() => {}, 1000);
    installShutdown(state, logger, async () => {});
    process.emit('SIGTERM');
  `, 13000);
  assert.equal(result.code, 1);
  assert.deepEqual(result.events, ['shutdown_started', 'shutdown_complete', 'shutdown_timeout']);
});
