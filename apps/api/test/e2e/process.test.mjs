import { test } from 'node:test';
import assert from 'node:assert/strict';
import { child, unusedPort, waitFor, stopChild } from '../helpers.mjs';

for (const role of ['api', 'worker']) {
  test(`${role} fails fast without configuration, never printing the supplied secret`, { timeout: 10000 }, async (t) => {
    const instance = child(role, { DATABASE_URL: 'invalid-secret-marker' });
    t.after(() => stopChild(instance));
    const [code] = await instance.exited;
    assert.equal(code, 1);
    assert.ok(instance.output().includes('startup_failed'));
    assert.ok(!instance.output().includes('secret-marker'));
  });

  test(`${role} survives DB outage and shuts down on SIGTERM`, { timeout: 15000 }, async (t) => {
    const port = await unusedPort();
    const dbPort = await unusedPort();
    const instance = child(role, { PORT: String(port), DATABASE_URL: `mysql://fixture:secret-marker@127.0.0.1:${dbPort}/rogichat_test` });
    t.after(() => stopChild(instance));
    await waitFor(() => instance.output().includes('started'));
    if (role === 'api') {
      assert.equal((await fetch(`http://127.0.0.1:${port}/live`)).status, 200);
      assert.equal((await fetch(`http://127.0.0.1:${port}/ready`)).status, 503);
    } else {
      await waitFor(() => instance.output().includes('database_unavailable'));
      await assert.rejects(fetch(`http://127.0.0.1:${port}/live`));
    }
    instance.proc.kill('SIGTERM');
    const [code, signal] = await instance.exited;
    assert.equal(code, 0);
    assert.equal(signal, null);
    assert.ok(instance.output().includes('shutdown_complete'));
    assert.ok(!instance.output().includes('secret-marker'));
  });
}
