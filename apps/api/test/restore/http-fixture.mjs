import assert from 'node:assert/strict';
import { child, stopChild, unusedPort, waitFor } from '../helpers.mjs';
export async function startApi(databaseUrl, authFile, epochFile) {
  const port = await unusedPort(), base = `http://127.0.0.1:${port}`;
  const instance = child('api', { DATABASE_URL: databaseUrl, PORT: String(port), AUTH_SECRET_FILE: authFile, AUTHORIZATION_EPOCH_FILE: epochFile });
  try { await waitFor(() => instance.output().includes('started'), 15000); assert.equal((await fetch(`${base}/ready`)).status, 200); }
  catch (error) { await stopChild(instance); throw error; }
  return { base, close: () => stopChild(instance) };
}
export async function request(api, person, path, { native = false, method = 'GET', body } = {}) {
  const response = await fetch(`${api.base}/v1${path}`, { method,
    headers: native ? { Authorization: `Bearer ${person.native.token}`, 'X-Rogi-Client': 'ios', 'Content-Type': 'application/json' }
      : { Cookie: `rogi_session=${person.token}`, Origin: 'http://localhost:3001', 'X-CSRF-Token': person.csrf, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
  return { status: response.status, body: await response.json() };
}
