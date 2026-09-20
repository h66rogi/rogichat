import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync, linkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { readDeletionConfig } from '../../dist/modules/deletion/deletion-config.js';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'm10-secret-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const media = { accountId: randomBytes(16).toString('hex'), bucket: 'fixture-media', accessKeyId: randomBytes(16).toString('hex'), secretAccessKey: randomBytes(32).toString('hex'), prefix: 'qa' };
  const value = { accountId: media.accountId, environment: 'qa', bucket: 'fixture-ledger', accessKeyId: randomBytes(16).toString('hex'), secretAccessKey: randomBytes(32).toString('hex') };
  const path = join(directory, 'secret.json');
  const write = data => writeFileSync(path, typeof data === 'string' ? data : JSON.stringify(data), { mode: 0o600 });
  write(value); return { directory, media, value, path, write, env: { DELETION_LEDGER_SECRET_FILE: path } };
}
const denied = fn => assert.throws(fn, { message: 'Invalid configuration: DELETION_LEDGER_SECRET_FILE' });
test('file-only ledger config binds environment/account and distinct bucket plus credential material', t => {
  const f = fixture(t);
  assert.equal(readDeletionConfig('qa', undefined, {}), undefined);
  assert.deepEqual(readDeletionConfig('qa', f.media, f.env), { ...f.value, mediaBucket: f.media.bucket });
  for (const environment of ['local', 'test', 'production']) denied(() => readDeletionConfig(environment, f.media, f.env));
  denied(() => readDeletionConfig('qa', undefined, f.env));
  for (const patch of [{ environment: 'production' }, { accountId: randomBytes(16).toString('hex') }, { bucket: f.media.bucket },
    { accessKeyId: f.media.accessKeyId }, { secretAccessKey: f.media.secretAccessKey }, { extra: true }, { bucket: 'bad/bucket' }]) {
    f.write({ ...f.value, ...patch }); denied(() => readDeletionConfig('qa', f.media, f.env));
  }
});
test('malformed/oversized secrets, unsafe permissions, hardlinks and symlinks fail with fixed redacted error', t => {
  const f = fixture(t);
  for (const value of ['not-json', 'x'.repeat(4097), '[]', '{}', '', '{"accessKeyId":"private"}']) {
    f.write(value); denied(() => readDeletionConfig('qa', f.media, f.env));
  }
  f.write(JSON.stringify(f.value).replace('{', '{"environment":"qa",')); denied(() => readDeletionConfig('qa', f.media, f.env));
  f.write(f.value); chmodSync(f.path, 0o640); denied(() => readDeletionConfig('qa', f.media, f.env)); chmodSync(f.path, 0o600);
  const symlink = join(f.directory, 'symlink'); symlinkSync(f.path, symlink);
  denied(() => readDeletionConfig('qa', f.media, { DELETION_LEDGER_SECRET_FILE: symlink }));
  const hardlink = join(f.directory, 'hardlink'); linkSync(f.path, hardlink);
  denied(() => readDeletionConfig('qa', f.media, f.env));
  denied(() => readDeletionConfig('qa', f.media, { DELETION_LEDGER_SECRET_FILE: '/missing/secret-with-private-path' }));
});

test('both real API and worker runtime settings load file-only ledger configuration', async t => {
  const { spawnSync } = await import('node:child_process');
  const f = fixture(t);
  const db = join(f.directory, 'db.json'), auth = join(f.directory, 'auth.json'), media = join(f.directory, 'media.json');
  writeFileSync(db, JSON.stringify({ host: 'db.example.invalid', port: 3306, username: 'fixture', password: 'fixture-only', database: 'rogichat' }), { mode: 0o600 });
  writeFileSync(auth, JSON.stringify({ key: randomBytes(32).toString('hex') }), { mode: 0o600 });
  const mediaSecret = { ...f.media }; delete mediaSecret.prefix; writeFileSync(media, JSON.stringify(mediaSecret), { mode: 0o600 });
  const script = `import { readRuntimeSettings } from './dist/infrastructure/config/runtime-settings.js';
    for (const role of ['api', 'worker']) {
      const s = readRuntimeSettings(role);
      if (s.deletion?.config.environment !== 'qa' || s.deletion.config.bucket !== 'fixture-ledger' || s.deletion.config.mediaBucket !== 'fixture-media') process.exit(1);
    }`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: {
    PATH: process.env.PATH, APP_ENV: 'qa', NODE_ENV: 'production', DATABASE_SECRET_FILE: db, DB_TLS_MODE: 'required',
    DB_CA_FILE: '/not-read-by-config/ca.pem', AUTH_SECRET_FILE: auth, MEDIA_SECRET_FILE: media, DELETION_LEDGER_SECRET_FILE: f.path,
  } });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, '');
});
