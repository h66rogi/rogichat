import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readSessionCredentials, readCommandCredentials, requireCommandProof } from '../../dist/modules/auth/auth-context.js';
import { socketCredentials } from '../../dist/modules/realtime/realtime.gateway.js';

const token = randomBytes(32).toString('base64url');
const proof = randomBytes(32).toString('base64url');
const config = { origin: 'https://chat.example.invalid', secure: true };
const headers = { authorization: `Bearer ${token}`, 'x-rogi-client': 'ios' };

test('native credentials are explicit, frozen, client-bound and never need spoofed Origin or CSRF', () => {
  const expected = { transport: 'NATIVE', token, clientId: 'ios' };
  for (const read of [readSessionCredentials, readCommandCredentials]) {
    const result = read({ headers }, config);
    assert.deepEqual(result, expected); assert.ok(Object.isFrozen(result));
    assert.deepEqual(read({ headers: { ...headers, 'x-rogi-client': 'android' } }, config), { ...expected, clientId: 'android' });
  }
  assert.doesNotThrow(() => requireCommandProof(expected));
  assert.throws(() => requireCommandProof({ ...expected, csrf: proof }));
  assert.throws(() => requireCommandProof({ ...expected, clientId: 'browser' }));
  assert.throws(() => requireCommandProof({ token }));
  assert.doesNotThrow(() => requireCommandProof({ token, csrf: proof }));
});

test('native REST rejects malformed/multiple headers, mixed session cookies and all native CSRF headers', () => {
  for (const bad of [
    { authorization: headers.authorization }, { 'x-rogi-client': 'ios' },
    { ...headers, authorization: 'Basic abc' }, { ...headers, authorization: `Bearer  ${token}` },
    { ...headers, authorization: `Bearer ${token}, Bearer ${token}` },
    { ...headers, authorization: [headers.authorization] },
    { ...headers, 'x-rogi-client': ['ios'] }, { ...headers, 'x-rogi-client': 'ios,android' },
    { ...headers, 'x-rogi-client': 'web' }, { ...headers, 'x-rogi-client': '' },
    { ...headers, 'x-csrf-token': proof }, { ...headers, 'x-csrf-token': '' },
    { ...headers, cookie: `__Host-rogi_session=${token}` },
    { ...headers, cookie: 'rogi_session=' }, { ...headers, cookie: 'x'.repeat(8193) },
  ]) for (const read of [readSessionCredentials, readCommandCredentials]) assert.throws(() => read({ headers: bad }, config));
  for (const name of ['Authorization', 'X-Rogi-Client', 'X-CSRF-Token']) {
    const request = { headers, rawHeaders: [name, 'one', name.toLowerCase(), 'two'] };
    assert.throws(() => readSessionCredentials(request, config));
  }
  assert.throws(() => readCommandCredentials({ headers: { cookie: `__Host-rogi_session=${token}`, 'x-csrf-token': proof } }, config), { code: 'FORBIDDEN' });
  assert.deepEqual(readCommandCredentials({ headers: { cookie: `__Host-rogi_session=${token}`, origin: config.origin, 'x-csrf-token': proof } }, config), { token, csrf: proof });
});

test('native websocket credentials only use upgrade headers and the exact native handshake', () => {
  const handshake = { schemaVersion: 1, transport: 'native' };
  assert.deepEqual(socketCredentials({ headers }, handshake, config), { transport: 'NATIVE', token, clientId: 'ios' });
  for (const auth of [undefined, { schemaVersion: 1 }, { ...handshake, accessToken: token }, { ...handshake, csrfToken: proof }, { ...handshake, transport: 'web' }]) {
    assert.throws(() => socketCredentials({ headers }, auth, config));
  }
  for (const bad of [{}, { ...headers, origin: 'https://evil.invalid' }, { ...headers, cookie: `__Host-rogi_session=${token}` }, { ...headers, 'x-csrf-token': proof }]) {
    assert.throws(() => socketCredentials({ headers: bad }, handshake, config));
  }
  assert.throws(() => socketCredentials({ headers, url: `/v1/realtime?token=${token}` }, handshake, config));
});
