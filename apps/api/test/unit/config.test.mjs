import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../../dist/config.js';
import { sampleEnv } from '../helpers.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('valid configuration is immutable; API and worker have independent pool defaults', () => {
  const config = readConfig('api', sampleEnv, []);
  assert.equal(config.database.poolSize, 5);
  assert.equal(readConfig('worker', sampleEnv, []).database.poolSize, 2);
  assert.equal(config.host, '127.0.0.1');
  assert.ok(Object.isFrozen(config.database));
});

for (const [key, value] of [
  ['APP_ENV', undefined], ['APP_ENV', 'unknown'], ['NODE_ENV', undefined], ['NODE_ENV', 'production'],
  ['DATABASE_URL', undefined], ['DATABASE_URL', 'mysql://secret@bad/private?password=do-not-log'],
  ['DATABASE_URL', 'postgres://a:b@localhost/rogichat'], ['DATABASE_URL', 'mysql://a:b@localhost/rogichat?ssl=false'],
  ['PORT', '0'], ['PORT', '65536'], ['PORT', '1.1'], ['PORT', '3000junk'],
  ['DB_POOL_SIZE', '11'], ['HOST', 'example.invalid'], ['DB_TLS_MODE', 'false'],
  ['NODE_OPTIONS', '--inspect=0.0.0.0:9229'], ['NODE_TLS_REJECT_UNAUTHORIZED', '0'],
]) {
  test(`reject unsafe/invalid ${key}: ${String(value)}`, () => {
    assert.throws(() => readConfig('api', { ...sampleEnv, [key]: value }, []), { message: `Invalid configuration: ${key}` });
  });
}

test('hosted environment requires file credentials, production mode, verified DB TLS and CA', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'rogichat-config-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'database.json');
  writeFileSync(file, JSON.stringify({ host: 'db.example.invalid', port: 3306, username: 'fixture', password: 'fixture-only', database: 'rogichat' }));
  const hosted = { ...sampleEnv, APP_ENV: 'qa', NODE_ENV: 'production', DATABASE_URL: undefined, DATABASE_SECRET_FILE: file, DB_CA_FILE: '/not-read-by-config/ca.pem' };
  assert.throws(() => readConfig('api', hosted, []), /DB_TLS_MODE/);
  assert.equal(readConfig('api', { ...hosted, DB_TLS_MODE: 'required' }, []).database.tls, true);
  assert.throws(() => readConfig('api', { ...hosted, NODE_ENV: 'development' }, []), /NODE_ENV/);
  assert.throws(() => readConfig('api', { ...hosted, DB_TLS_MODE: 'required', DB_CA_FILE: undefined }, []), /DB_CA_FILE/);
  assert.throws(() => readConfig('api', { ...hosted, DATABASE_SECRET_FILE: undefined }, []), /DATABASE_SECRET_FILE/);
  assert.throws(() => readConfig('api', { ...hosted, DATABASE_URL: sampleEnv.DATABASE_URL }, []), /DATABASE_SOURCE/);
  writeFileSync(file, 'invalid-secret-marker');
  assert.throws(() => readConfig('api', hosted, []), { message: 'Invalid configuration: DATABASE_SECRET_FILE' });
});

test('cleartext DB is restricted to loopback even in development', () => {
  assert.throws(() => readConfig('api', { ...sampleEnv, DATABASE_URL: 'mysql://a:b@db.example.invalid/rogichat_test' }, []), /DB_TLS_MODE/);
});

test('command-line inspector and insecure parser flags are rejected', () => {
  assert.throws(() => readConfig('api', sampleEnv, ['--inspect']), /NODE_OPTIONS/);
  assert.throws(() => readConfig('api', sampleEnv, ['--insecure-http-parser']), /NODE_OPTIONS/);
  assert.throws(() => readConfig('api', { ...sampleEnv, NODE_OPTIONS: '"--inspect=9229"' }, []), /NODE_OPTIONS/);
  assert.equal(readConfig('api', sampleEnv, ['--inspect-port=9229', '--inspect-publish-uid=stderr,http']).role, 'api');
});
