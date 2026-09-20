import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { mediaKey, readMediaConfig, R2MediaStore } from '../../dist/modules/media/adapters/media-store.js';

test('private R2 configuration is file-only, strict and missing configuration disables media', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'media-config-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'config.json');
  const credentials = { accountId: randomBytes(16).toString('hex'), bucket: 'fixture-private', accessKeyId: randomBytes(16).toString('hex'), secretAccessKey: randomBytes(32).toString('hex') };
  assert.equal(readMediaConfig('qa', {}), undefined);
  await writeFile(file, JSON.stringify(credentials), { mode: 0o600 });
  const config = readMediaConfig('qa', { MEDIA_SECRET_FILE: file });
  assert.equal(config.prefix, 'qa'); assert.equal(config.bucket, credentials.bucket); assert.ok(Object.isFrozen(config));
  await chmod(file, 0o644); assert.throws(() => readMediaConfig('qa', { MEDIA_SECRET_FILE: file }), { field: 'MEDIA_SECRET_FILE' });
  await chmod(file, 0o600);
  for (const mutation of [{ endpoint: 'https://example.invalid' }, { bucket: '../other' }, { accountId: 'arbitrary-host' }, { public: true }]) {
    await writeFile(file, JSON.stringify({ ...credentials, ...mutation }));
    assert.throws(() => readMediaConfig('qa', { MEDIA_SECRET_FILE: file }), error => error.field === 'MEDIA_SECRET_FILE' && !error.message.includes(credentials.secretAccessKey));
  }
});

test('signed GET is exactly 60 seconds and key/environment scope cannot be selected by a caller', async () => {
  const config = { accountId: randomBytes(16).toString('hex'), bucket: 'fixture-private', accessKeyId: randomBytes(16).toString('hex'), secretAccessKey: randomBytes(32).toString('hex'), prefix: 'test' };
  const store = new R2MediaStore(config);
  try {
    const key = mediaKey('test', randomUUID(), randomUUID(), 'image');
    const url = new URL(await store.signedGet(key));
    assert.equal(url.protocol, 'https:'); assert.equal(url.hostname, `${config.accountId}.r2.cloudflarestorage.com`);
    assert.equal(url.pathname, `/${config.bucket}/${key}`); assert.equal(url.searchParams.get('X-Amz-Expires'), '60');
    assert.equal(url.searchParams.get('x-id'), 'GetObject'); assert.ok(url.searchParams.get('X-Amz-Signature'));
    for (const invalid of [key.replace('test/', 'qa/'), key + '?x=1', key.replace('/image', '/../../secrets'), 'https://example.invalid/private']) {
      assert.throws(() => store.signedGet(invalid), /invalid_media_key/);
    }
    assert.equal('signedPut' in store, false);
  } finally { store.close(); }
});
