import { queries, fingerprint } from '../../../../tools/operations/backend_schema_readonly.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createConnection } from 'mysql2/promise';
import { migrationManifest } from '../../dist/infrastructure/database/schema-manifest.js';
import { child, unusedPort, waitFor, stopChild } from '../helpers.mjs';
import { createApi } from '../../dist/application.js';
import { PrismaDatabase } from '../../dist/infrastructure/database/database.js';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { createOpenApiDocument } from '../../dist/infrastructure/openapi/openapi.js';
import { initializeDefaultRoom } from '../../dist/modules/owner-bootstrap/default-room-initialize.js';
import { DEFAULT_ROOM_ID } from '../../dist/modules/owner-bootstrap/default-room.config.js';

const require = createRequire(import.meta.url);

test('product schema upgrade rejects previous/partial/drifted ledgers and accepts only the exact current manifest', { timeout: 180000 }, async t => {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const adminUrl = new URL(process.env.TEST_ADMIN_URL);
  assert.equal(adminUrl.hostname, '127.0.0.1');
  assert.match(adminUrl.pathname, /^\/rogichat_test_[a-f0-9]{16}$/);
  assert.ok(migrationManifest.length > 13);
  const previousCount = migrationManifest.length - 1;
  const nativeIndex = migrationManifest.findIndex(entry => entry.name.endsWith('_native_push_providers'));
  assert.ok(nativeIndex > 0, 'native push migration must be present');
  const initialCount = Math.min(previousCount, nativeIndex);
  const name = `rogichat_test_${randomBytes(8).toString('hex')}`;
  const runtimeUrl = new URL(process.env.DATABASE_URL);
  assert.equal(runtimeUrl.hostname, adminUrl.hostname);
  assert.equal(runtimeUrl.port, adminUrl.port);
  assert.match(runtimeUrl.username, /^fixture_[a-f0-9]{16}$/);
  const admin = await createConnection(adminUrl.href);
  const directory = await mkdtemp(join(tmpdir(), 'rogichat-schema-upgrade-'));
  let created = false;
  t.after(async () => {
    try { if (created) await admin.query(`DROP DATABASE \`${name}\``); }
    finally { await admin.end(); await rm(directory, { recursive: true, force: true }); }
  });
  await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`); created = true;
  await admin.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON \`${name}\`.* TO ?@'%'`, [runtimeUrl.username]);
  await admin.query(`USE \`${name}\``);
  adminUrl.pathname = `/${name}`; runtimeUrl.pathname = `/${name}`;
  const migrations = join(directory, 'migrations'); await mkdir(migrations);
  await copyFile('prisma/migrations/migration_lock.toml', join(migrations, 'migration_lock.toml'));
  for (const entry of migrationManifest.slice(0, initialCount)) {
    await mkdir(join(migrations, entry.name));
    await copyFile(`prisma/migrations/${entry.name}/migration.sql`, join(migrations, entry.name, 'migration.sql'));
  }
  const config = join(directory, 'prisma.config.mjs');
  // URL stays in child environment, never argv/output/config files.
  await writeFile(config, `export default {schema:${JSON.stringify(resolve('prisma/schema.prisma'))},migrations:{path:${JSON.stringify(migrations)}},datasource:{url:process.env.DATABASE_URL}};`);
  const migrate = async () => {
    const proc = spawn(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--config', config], {
      env: { PATH: process.env.PATH, DATABASE_URL: adminUrl.href, CHECKPOINT_DISABLE: '1' }, stdio: 'ignore', timeout: 60000,
    });
    const [code, signal] = await once(proc, 'exit'); assert.equal(code, 0); assert.equal(signal, null);
  };
  const probe = async ready => {
    const port = await unusedPort();
    const api = child('api', { DATABASE_URL: runtimeUrl.href, PORT: String(port) });
    const worker = child('worker', { DATABASE_URL: runtimeUrl.href });
    try {
      await waitFor(() => api.output().includes('started'));
      await waitFor(() => worker.output().includes(`"reason":"${ready ? 'ready' : 'schema_mismatch'}"`));
      assert.equal((await fetch(`http://127.0.0.1:${port}/ready`)).status, ready ? 200 : 503);
    } finally { await stopChild(api); await stopChild(worker); }
  };
  await migrate();
  // Use the actual pre-native schema: generated current Prisma models already
  // reference provider columns that do not exist here. Bound SQL is fixture-only.
  const legacy = { user: randomUUID(), session: randomUUID(), subscription: randomUUID(),
    audience: 'schema-upgrade-fixture', endpoint: 'https://push.example.invalid/legacy-fixture',
    endpointDigest: randomBytes(32), p256dh: randomBytes(65).toString('base64url'), auth: randomBytes(16).toString('base64url') };
  await admin.execute('INSERT INTO users (id) VALUES (?)', [legacy.user]);
  await admin.execute('INSERT INTO auth_sessions (id,user_id,token_digest,csrf_digest,audience,expires_at) VALUES (?,?,?,?,?,TIMESTAMPADD(HOUR,1,UTC_TIMESTAMP(3)))',
    [legacy.session, legacy.user, randomBytes(32), randomBytes(32), legacy.audience]);
  await admin.execute('INSERT INTO notification_preferences (user_id,push_enabled,generation) VALUES (?,1,7)', [legacy.user]);
  await admin.execute('INSERT INTO push_subscriptions (id,user_id,session_id,audience,endpoint,endpoint_digest,p256dh,auth_secret,generation,account_generation) VALUES (?,?,?,?,?,?,?,?,11,7)',
    [legacy.subscription, legacy.user, legacy.session, legacy.audience, legacy.endpoint, legacy.endpointDigest, legacy.p256dh, legacy.auth]);
  const [legacyBefore] = await admin.execute('SELECT * FROM push_subscriptions WHERE id=?', [legacy.subscription]);
  // Keep the existing previous/partial/current readiness checks valid when a
  // later migration is appended; the populated 22→23 upgrade still runs first.
  for (const entry of migrationManifest.slice(initialCount, previousCount)) {
    await mkdir(join(migrations, entry.name));
    await copyFile(`prisma/migrations/${entry.name}/migration.sql`, join(migrations, entry.name, 'migration.sql'));
  }
  if (initialCount < previousCount) await migrate();
  const [twelve] = await admin.query('SELECT COUNT(*) AS n FROM _prisma_migrations'); assert.equal(twelve[0].n, previousCount);
  await probe(false);
  const last = migrationManifest[previousCount]; await mkdir(join(migrations, last.name));
  await copyFile(`prisma/migrations/${last.name}/migration.sql`, join(migrations, last.name, 'migration.sql'));
  await migrate();
  // Official migration completion includes domain initialization with the
  // runtime DML credential, before any API ready/open acceptance.
  const initialized = new PrismaDatabase(readConfig('worker', { ...process.env, DATABASE_URL: runtimeUrl.href }));
  try { await initializeDefaultRoom(initialized); await initializeDefaultRoom(initialized); }
  finally { await initialized.close(); }
  const [catalog] = await admin.execute('SELECT r.id,r.status,r.owner_member_id,c.room_id,s.kind,b.owner_bound FROM rooms r JOIN room_counters c ON c.room_id=r.id JOIN message_streams s ON s.room_id=r.id AND s.kind=\'ROOM_SHARED\' JOIN default_room_bindings b ON b.room_id=r.id WHERE r.id=?', [DEFAULT_ROOM_ID]);
  assert.equal(catalog.length, 1); assert.equal(catalog[0].status, 'ACTIVE'); assert.equal(catalog[0].owner_member_id, null); assert.equal(Number(catalog[0].owner_bound), 0);
  const [userCount] = await admin.query('SELECT COUNT(*) AS n FROM users'); assert.equal(Number(userCount[0].n), 1, 'initializer does not fabricate users');
  await probe(true);
  const [legacyAfter] = await admin.execute('SELECT * FROM push_subscriptions WHERE id=?', [legacy.subscription]);
  assert.equal(legacyAfter.length, 1);
  const { provider, binding_digest, installation_id, native_client_id, native_token, ...preserved } = legacyAfter[0];
  assert.equal(provider, 'WEB');
  assert.deepEqual([binding_digest, installation_id, native_client_id, native_token], [null, null, null, null]);
  assert.deepEqual(preserved, legacyBefore[0], 'all legacy endpoint/key/ownership/generation/timestamp values survive the real migration');
  const [preferences] = await admin.execute('SELECT push_enabled,generation FROM notification_preferences WHERE user_id=?', [legacy.user]);
  assert.equal(preferences[0].push_enabled, 1); assert.equal(String(preferences[0].generation), '7');
  const physical = async () => {
    const schema = {}; for (const [key, sql] of Object.entries(queries)) [schema[key]] = await admin.query(sql);
    return fingerprint(schema);
  };
  const [before] = await admin.query('SELECT * FROM _prisma_migrations ORDER BY migration_name');
  const beforePhysical = await physical();
  await migrate();
  const [after] = await admin.query('SELECT * FROM _prisma_migrations ORDER BY migration_name');
  assert.deepEqual(after, before, 'current manifest migrate is a ledger no-op');
  assert.equal(await physical(), beforePhysical, 'current manifest migrate leaves physical schema unchanged');
  for (const [column, value] of [['finished_at', null], ['checksum', '0'.repeat(64)]]) {
    const original = before.find(row => row.migration_name === last.name);
    await admin.query(`UPDATE _prisma_migrations SET ${column}=? WHERE migration_name=?`, [value, last.name]);
    try { await probe(false); }
    finally { await admin.query(`UPDATE _prisma_migrations SET ${column}=? WHERE migration_name=?`, [original[column], last.name]); }
  }
  const extra = randomUUID();
  await admin.query('INSERT INTO _prisma_migrations (id,checksum,migration_name,started_at,finished_at,applied_steps_count) VALUES (?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),1)', [extra, '1'.repeat(64), '20990101000000_fixture_unapproved']);
  try { await probe(false); }
  finally { await admin.query('DELETE FROM _prisma_migrations WHERE id=?', [extra]); }
  await probe(true);
});

test('normal product composition registers native SOOP issuance in HTTP and OpenAPI', async t => {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const database = new PrismaDatabase(readConfig('api'));
  const config = { audience: 'product-composition-test', key: randomBytes(32), origin: 'http://localhost:3001', secure: false };
  const app = await createApi(database, { event() {} }, undefined, { config });
  t.after(async () => { await app.close(); await database.close(); });
  await app.listen(0, '127.0.0.1');
  const document = createOpenApiDocument(app, config);
  for (const path of ['/v1/auth/native/soop/transactions', '/v1/auth/native/completions/exchange']) {
    assert.ok(document.paths[path]?.post);
    assert.equal((await fetch(await app.getUrl() + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 400);
  }
  assert.ok(document.paths['/v1/auth/session']); assert.ok(document.paths['/v1/auth/logout']);
});
