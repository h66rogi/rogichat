import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runVideoProcess } from '../../dist/isolated/media-decoder/video-process.js';

const options = { timeoutMs: 2000, stdoutBytes: 1024 };
const run = (code, overrides = {}) => runVideoProcess(process.execPath, ['--input-type=module', '-e', code], { ...options, ...overrides });

test('decoder child receives no parent credentials, ignores stdin and returns bounded bytes', async () => {
  process.env.ROGICHAT_VIDEO_TEST_SECRET = 'test-only-value';
  try {
    const result = await run('process.stdout.write(JSON.stringify({secret:process.env.ROGICHAT_VIDEO_TEST_SECRET,keys:Object.keys(process.env).sort()}))');
    const child = JSON.parse(result);
    assert.equal(child.secret, undefined);
    // macOS itself can add its CoreFoundation encoding setting during process startup.
    assert.deepEqual(child.keys.filter(key => process.platform !== 'darwin' || key !== '__CF_USER_TEXT_ENCODING'), ['LANG', 'LC_ALL']);
    assert.equal((await run('let n=0;for await(const b of process.stdin)n+=b.length;process.stdout.write(String(n))')).toString(), '0');
  } finally { delete process.env.ROGICHAT_VIDEO_TEST_SECRET; }
});

test('bounded stdout and discarded stderr overflow kill and reject without leaking child text', async () => {
  for (const stream of ['stdout', 'stderr']) {
    await assert.rejects(run(`process.${stream}.write('private'.repeat(20000));setInterval(()=>{},1000)`), { message: 'VIDEO_PROCESS_LIMIT' });
  }
  await assert.rejects(run('process.stderr.write("private");process.exit(1)'), { message: 'VIDEO_PROCESS_FAILED' });
});

test('deadline and abort hard-kill child before promise settles', async () => {
  await assert.rejects(run('setInterval(()=>{},1000)', { timeoutMs: 30 }), { message: 'VIDEO_PROCESS_LIMIT' });
  const controller = new globalThis.AbortController();
  const operation = run('setInterval(()=>{},1000)', { signal: controller.signal });
  controller.abort();
  await assert.rejects(operation, { message: 'VIDEO_PROCESS_ABORTED' });
  await assert.rejects(run('process.exit(0)', { signal: controller.signal }), { message: 'VIDEO_PROCESS_ABORTED' });
});

test('missing executable and invalid resource bounds fail closed without exposing paths', async () => {
  await assert.rejects(runVideoProcess('/nonexistent/rogichat-video-test', [], options), { message: 'VIDEO_PROCESS_FAILED' });
  await assert.rejects(runVideoProcess('node', [], options), { message: 'VIDEO_PROCESS_FAILED' });
  for (const patch of [{ timeoutMs: 0 }, { timeoutMs: 180001 }, { stdoutBytes: -1 }, { stdoutBytes: 65537 }]) {
    await assert.rejects(run('process.exit(0)', patch), { message: 'VIDEO_PROCESS_FAILED' });
  }
});
