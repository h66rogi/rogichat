import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {connectionURL, validateCredential, validateGrants, validateHistory, validateManifest} from './migrate_entry.mjs';

const host = 'rogichat-qa.cluster-fixture.ap-northeast-2.rds.amazonaws.com';
const hostHash = crypto.createHash('sha256').update(host).digest('hex');
const credential = {host, port: 3306, database: 'rogichatqa', username: 'rogichat_migrator',
  password: 'fixture-only-@:/?#% special characters'};

const manifest = [
  {name: '20260919171609_m02_foundation', checksum: 'a'.repeat(64)},
  {name: '20260920100000_native_transport', checksum: 'b'.repeat(64)},
];

test('migration approval accepts reordered JSON fields without changing migration identity', () => {
  const approved = JSON.parse(JSON.stringify(manifest.map(({name, checksum}) => ({checksum, name}))));
  assert.notEqual(JSON.stringify(manifest), JSON.stringify(approved));
  validateManifest(manifest, approved);
  validateManifest(approved, manifest);
});

test('migration approval still rejects changed, omitted, extra, reordered and duplicate migrations', () => {
  const invalid = [manifest.slice(1), [...manifest, {...manifest[1], name: '20260921100000_extra'}],
    [...manifest].reverse(), [manifest[0], manifest[0]],
    [manifest[0], {...manifest[1], checksum: 'c'.repeat(64)}],
    [manifest[0], {...manifest[1], name: '20260920100000_different'}]];
  for (const candidate of invalid) {
    assert.throws(() => validateManifest(manifest, candidate));
    assert.throws(() => validateManifest(candidate, manifest));
  }
});

test('migration approval rejects malformed manifests and unknown entry fields on both sides', () => {
  const invalid = [null, {}, [], 'manifest', Array(101).fill(manifest[0]),
    [null], [[]], [{...manifest[0], extra: true}], [{name: manifest[0].name}],
    [{...manifest[0], name: 1}], [{...manifest[0], name: 'not_a_migration'}],
    [{...manifest[0], checksum: 'A'.repeat(64)}], [{...manifest[0], checksum: 1}]];
  for (const candidate of invalid) {
    assert.throws(() => validateManifest(candidate, manifest));
    assert.throws(() => validateManifest(manifest, candidate));
  }
});

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
