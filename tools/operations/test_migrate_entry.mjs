import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {connectionURL, validateCredential, validateGrants, validateHistory} from './migrate_entry.mjs';

const host = 'rogichat-qa.cluster-fixture.ap-northeast-2.rds.amazonaws.com';
const hostHash = crypto.createHash('sha256').update(host).digest('hex');
const credential = {host, port: 3306, database: 'rogichatqa', username: 'rogichat_migrator',
  password: 'fixture-only-@:/?#% special characters'};

test('exact QA target, role and secret JSON shape', () => {
  assert.equal(validateCredential(credential, 'rogichat_migrator', hostHash), credential);
  for (const patch of [{host: 'localhost'}, {database: 'production'}, {username: 'root'},
    {port: '3306'}, {password: 'short'}, {extra: true}]) {
    assert.throws(() => validateCredential({...credential, ...patch}, 'rogichat_migrator', hostHash));
  }
  assert.throws(() => validateCredential(credential, 'rogichat_migrator', '0'.repeat(64)));
});

test('DSN percent encoding and mandatory certificate verification', () => {
  const url = new URL(connectionURL(credential));
  assert.equal(decodeURIComponent(url.password), credential.password);
  assert.equal(url.searchParams.get('sslaccept'), 'strict');
  assert.equal(url.searchParams.get('sslcert'), '/run/secrets/rds-ca.pem');
  assert.equal(url.hostname, host);
});

test('runtime cannot carry DDL, global privileges, roles or grant option', () => {
  const usage = {grant: "GRANT USAGE ON *.* TO `rogichat_app`@`%` REQUIRE SSL"};
  const dml = {grant: "GRANT SELECT, INSERT, UPDATE, DELETE ON `rogichatqa`.* TO `rogichat_app`@`%`"};
  validateGrants([usage, dml], 'rogichat_app');
  for (const text of [dml.grant + ' WITH GRANT OPTION', dml.grant.replace('SELECT', 'CREATE, SELECT'),
    dml.grant.replace('`rogichatqa`.*', '*.*'), 'GRANT `admin`@`%` TO `rogichat_app`@`%`']) {
    assert.throws(() => validateGrants([usage, {grant: text}], 'rogichat_app'));
  }
  assert.throws(() => validateGrants([usage], 'rogichat_app'));
});

test('only successful ordered migration prefix is accepted before deploy', () => {
  const manifest = [{name: '20260919171609_m02_foundation', checksum: 'a'.repeat(64)}];
  const row = {migration_name: manifest[0].name, checksum: manifest[0].checksum, finished_at: new Date(), rolled_back_at: null};
  validateHistory([], manifest);
  validateHistory([row], manifest, true);
  assert.throws(() => validateHistory([], manifest, true));
  for (const patch of [{finished_at: null}, {rolled_back_at: new Date()}, {checksum: 'b'.repeat(64)}, {migration_name: 'unknown'}]) {
    assert.throws(() => validateHistory([{...row, ...patch}], manifest));
  }
  assert.throws(() => validateHistory([row, row], manifest));
});
