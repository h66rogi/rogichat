import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { realpathSync, mkdtempSync, writeFileSync, chmodSync, symlinkSync, linkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readPushConfig } from '../../dist/modules/notifications/push-config.js';
import { vapidPrivateKey } from '../support/vapid-key.mjs';

function fixture(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'push-config-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const key = createECDH('prime256v1'); key.generateKeys();
  const value = { environment: 'qa', subject: 'mailto:push@example.com', publicKey: key.getPublicKey().toString('base64url'), privateKey: vapidPrivateKey(key) };
  const path = join(dir, 'secret.json');
  const write = text => writeFileSync(path, text ?? JSON.stringify(value), { mode: 0o600 });
  write();
  const env = { APP_ENV: 'qa', PUSH_VAPID_SECRET_FILE: path };
  return { dir, path, value, write, env };
}
test('hosted file-only configuration binds exact environment and exposes no secret in errors', t => {
  const f = fixture(t);
  const expected = { ...f.value }; delete expected.environment;
  assert.deepEqual(readPushConfig(f.env), { audience: 'rogi-qa', vapid: expected });
  f.write(JSON.stringify(f.value).replace('mailto:', 'mailto\\u003a'));
  assert.deepEqual(readPushConfig(f.env).vapid, expected);
  f.write();
  chmodSync(f.path, 0o400); assert.deepEqual(readPushConfig(f.env).vapid, expected); chmodSync(f.path, 0o600);
  for (const APP_ENV of ['qa', 'production']) {
    assert.deepEqual(readPushConfig({ APP_ENV }), { audience: `rogi-${APP_ENV}`, vapid: null });
    for (const field of ['SUBJECT', 'PUBLIC_KEY', 'PRIVATE_KEY']) {
      const name = `PUSH_${APP_ENV.toUpperCase()}_VAPID_${field}`;
      for (const value of ['', 'supplied']) assert.throws(() => readPushConfig({ APP_ENV, [name]: value }), /^Error: invalid_push_vapid$/);
    }
  }
  for (const env of [{ ...f.env, APP_ENV: 'production' }, { ...f.env, PUSH_QA_VAPID_SUBJECT: f.value.subject }, { ...f.env, PUSH_VAPID_PRIVATE_KEY: f.value.privateKey }, { APP_ENV: 'qa', PUSH_VAPID_SECRET_FILE: '' }, { ...f.env, PUSH_VAPID_SECRET_FILE: join(f.dir, 'missing') }]) assert.throws(() => readPushConfig(env), /^Error: invalid_push_vapid$/);
  assert.throws(() => readPushConfig({ APP_ENV: 'QA' }), /invalid_push_environment/);
});
test('secret file rejects ambiguous JSON, unknown fields, malformed UTF8 and noncanonical keys', t => {
  const f = fixture(t); const json = JSON.stringify(f.value);
  for (const text of [
    json.replace('"environment"', '"environ\\u006dent"'), json.slice(0, -1) + ',"environ\\u006dent":"qa"}', json.replace('{', '{"environment":"qa",'),
    JSON.stringify({ ...f.value, unexpected: 'value' }), JSON.stringify({ ...f.value, privateKey: null }),
    JSON.stringify({ ...f.value, privateKey: f.value.privateKey + '=' }), JSON.stringify({ ...f.value, publicKey: f.value.publicKey + '=' }),
    JSON.stringify({ ...f.value, subject: 'file:///secret' }), JSON.stringify({ ...f.value, environment: 'production' }),
    json.slice(0, -1) + ',}', json + '{}', '[]', '{}', '', ' '.repeat(4097), '\ufeff' + json,
    Buffer.concat([Buffer.from(json), Buffer.from([0xff])]),
  ]) { f.write(text); assert.throws(() => readPushConfig(f.env), /^Error: invalid_push_vapid$/); }
  const other = createECDH('prime256v1'); other.generateKeys();
  f.write(JSON.stringify({ ...f.value, privateKey: vapidPrivateKey(other) })); assert.throws(() => readPushConfig(f.env), /invalid_push_vapid/);
  // Base64url decoders ignore nonzero pad bits: reject aliases of the same scalar.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const last = alphabet.indexOf(f.value.privateKey.at(-1));
  f.write(JSON.stringify({ ...f.value, privateKey: f.value.privateKey.slice(0, -1) + alphabet[last + 1] })); assert.throws(() => readPushConfig(f.env), /invalid_push_vapid/);
});

test('VAPID fixture preserves short P-256 scalars as canonical 32-byte keys without weakening runtime validation', () => {
  for (const length of [1, 2, 31, 32]) {
    const key = createECDH('prime256v1');
    key.setPrivateKey(Buffer.alloc(length, 0x11));
    assert.equal(key.getPrivateKey().length, length);
    const privateKey = vapidPrivateKey(key);
    const bytes = Buffer.from(privateKey, 'base64url');
    assert.equal(bytes.length, 32); assert.equal(privateKey.length, 43);
    assert.deepEqual(bytes.subarray(0, 32 - length), Buffer.alloc(32 - length));
    assert.deepEqual(bytes.subarray(32 - length), key.getPrivateKey());
    const restored = createECDH('prime256v1'); restored.setPrivateKey(bytes);
    assert.deepEqual(restored.getPublicKey(), key.getPublicKey());
    const env = { APP_ENV: 'test', PUSH_TEST_VAPID_SUBJECT: 'mailto:push@example.com', PUSH_TEST_VAPID_PUBLIC_KEY: key.getPublicKey().toString('base64url'), PUSH_TEST_VAPID_PRIVATE_KEY: privateKey };
    assert.equal(readPushConfig(env).vapid.privateKey, privateKey);
    if (length < 32) assert.throws(() => readPushConfig({ ...env, PUSH_TEST_VAPID_PRIVATE_KEY: key.getPrivateKey().toString('base64url') }), /^Error: invalid_push_vapid$/);
  }
});
test('only single-link regular files with private owner modes are accepted', t => {
  const f = fixture(t);
  for (const mode of [0o644, 0o640, 0o660, 0o700, 0o000, 0o4600]) { chmodSync(f.path, mode); assert.throws(() => readPushConfig(f.env), /invalid_push_vapid/); }
  chmodSync(f.path, 0o600);
  const symbolic = join(f.dir, 'symbolic'); symlinkSync(f.path, symbolic);
  assert.throws(() => readPushConfig({ ...f.env, PUSH_VAPID_SECRET_FILE: symbolic }), /invalid_push_vapid/);
  assert.throws(() => readPushConfig({ ...f.env, PUSH_VAPID_SECRET_FILE: f.dir }), /invalid_push_vapid/);
  assert.throws(() => readPushConfig({ ...f.env, PUSH_VAPID_SECRET_FILE: 'relative.json' }), /invalid_push_vapid/);
  linkSync(f.path, join(f.dir, 'hardlink')); assert.throws(() => readPushConfig(f.env), /invalid_push_vapid/);
});


test('API and worker runtime settings load hosted file configuration and fail closed', t => {
  const f = fixture(t);
  const database = join(f.dir, 'database.json'), auth = join(f.dir, 'auth.json');
  writeFileSync(database, JSON.stringify({ host: 'db.example.invalid', port: 3306, username: 'fixture', password: randomBytes(24).toString('hex'), database: 'rogichat' }));
  writeFileSync(auth, JSON.stringify({ key: randomBytes(32).toString('hex') }));
  const env = { ...f.env, NODE_ENV: 'production', DATABASE_SECRET_FILE: database, DB_TLS_MODE: 'required', DB_CA_FILE: '/not-read-by-config/ca.pem', AUTH_SECRET_FILE: auth };
  const module = new URL('../../dist/infrastructure/config/runtime-settings.js', import.meta.url).href;
  for (const role of ['api', 'worker']) {
    const script = `import { readRuntimeSettings } from ${JSON.stringify(module)}; const settings = readRuntimeSettings('${role}'); if (!settings.push.vapid || settings.push.audience !== 'rogi-qa') process.exit(2);`;
    const valid = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env, encoding: 'utf8', timeout: 15000 });
    assert.equal(valid.status, 0, valid.stderr);
    const invalid = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...env, PUSH_QA_VAPID_PRIVATE_KEY: 'disallowed' }, encoding: 'utf8', timeout: 15000 });
    assert.notEqual(invalid.status, 0); assert.match(invalid.stderr, /invalid_push_vapid/);
  }
});
