// Cryptographic provider emulator exclusively in isolated tests, never runtime.
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
export function appleFixture() {
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const signing = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const config = { teamId: 'TESTTEAM00', keyId: 'TESTKEY000', privateKey: signing.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    clients: { ios: { audience: 'chat.example.test', scope: 'test-primary' }, android: { audience: 'chat.example.web', scope: 'test-primary' }, web: { audience: 'chat.example.web', scope: 'test-primary' } },
    callback: 'https://api.qa.rogi.chat/v1/auth/apple/callback' };
  const codes = new Map(); const requests = []; const revokes = [];
  let failRevoke = false; let failKeys = false; let responseTransform = value => value;
  function jwt(claims, header = {}) {
    const first = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-rsa', ...header })).toString('base64url');
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return `${first}.${body}.${sign('RSA-SHA256', Buffer.from(`${first}.${body}`), rsa.privateKey).toString('base64url')}`;
  }
  function claims(client, nonce, subject = `test-${randomUUID()}`, changes = {}) {
    const now = Math.floor(Date.now() / 1000);
    return { iss: 'https://appleid.apple.com', aud: config.clients[client].audience, sub: subject, iat: now, exp: now + 600, nonce, ...changes };
  }
  function code(client, nonce, subject, changes = {}) {
    const value = randomUUID(); const payload = claims(client, nonce, subject, changes);
    codes.set(value, { client, payload });
    return { code: value, identityToken: jwt({ ...payload, c_hash: createHash('sha256').update(value).digest().subarray(0, 16).toString('base64url') }), subject: payload.sub };
  }
  async function request(url, input) {
    requests.push({ url, input });
    if (url.endsWith('/auth/keys')) return failKeys ? new globalThis.Response('{}', { status: 503 }) : globalThis.Response.json({ keys: [{ ...rsa.publicKey.export({ format: 'jwk' }), kid: 'test-rsa', alg: 'RS256', use: 'sig' }] });
    const form = new globalThis.URLSearchParams(input.body);
    if (url.endsWith('/auth/revoke')) { revokes.push(form); return new globalThis.Response('', { status: failRevoke ? 503 : 200 }); }
    const stored = codes.get(form.get('code')); codes.delete(form.get('code'));
    if (!stored) return globalThis.Response.json({ error: 'invalid_grant' }, { status: 400 });
    if (form.get('client_id') !== config.clients[stored.client].audience) return new globalThis.Response('{}', { status: 400 });
    return globalThis.Response.json(responseTransform({ id_token: jwt(stored.payload), token_type: 'Bearer', refresh_token: `fixture-refresh-${randomUUID()}` }));
  }
  return { config, code, claims, jwt, request, requests, revokes,
    set failRevoke(value) { failRevoke = value; }, set failKeys(value) { failKeys = value; }, set responseTransform(value) { responseTransform = value; } };
}
