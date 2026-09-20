import { createReadStream } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readdir, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { RestoreMediaRepository } from '../../dist/modules/media/restore-media.repository.js';
import { RestoreMediaService } from '../../dist/modules/media/restore-media.service.js';
import { RESTORE_MEDIA_MAXIMUMS, restoreMediaDigest } from '../../dist/modules/media/restore-media.types.js';
import { imageBytes, videoBytes } from './restore-media-bytes.mjs';

const { structuredClone, AbortController } = globalThis;
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export async function restoreMediaFixture(t, { video = false, limits = {} } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'rogichat-restore-media-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const assetId = randomUUID(), ownerId = randomUUID(), attempt = randomUUID();
  const snapshot = { assets: [{ id: assetId, owner_user_id: ownerId, room_id: null, kind: video ? 'VIDEO' : 'PHOTO', state: 'READY',
    deleted_at: null, expires_at: new Date('2030-01-01T00:00:00Z'), reserved_bytes: 1n,
    owner: { status: 'ACTIVE' }, catalog_entry: null, attachments: [], avatar_profile: null, publication_sources: [] }], objects: [], attempts: [], provenance: [], checkpoints: [] };
  const put = async (key, bytes) => { const path = join(directory, key); await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, bytes); };
  for (const [variant, bytes] of video ? [['video', videoBytes], ['poster', imageBytes]] : [['image', imageBytes]]) {
    const key = `test/${assetId}/${attempt}/${variant}`;
    snapshot.objects.push({ id: randomUUID(), asset_id: assetId, attempt_id: attempt, variant, object_key: key, state: 'READY', byte_length: BigInt(bytes.length), sha256: sha(bytes) });
    await put(key, bytes);
  }
  const hooks = {}, calls = { list: 0, read: 0, db: 0 }, streams = [];
  let insideDb = false;
  const tx = () => {
    const view = structuredClone(snapshot);
    const names = { media_assets: 'assets', media_objects: 'objects', media_cleanup_attempts: 'attempts', account_media_provenance: 'provenance', media_cleanup_checkpoints: 'checkpoints' };
    return { prisma: Object.fromEntries(Object.entries(names).map(([name, field]) => [name, { async findMany(query) {
      assert.ok(query.take > 0 && query.take <= RESTORE_MEDIA_MAXIMUMS.rows + 1);
      const order = Array.isArray(query.orderBy) ? query.orderBy : [query.orderBy];
      return view[field].sort((a, b) => { for (const entry of order) { const key = Object.keys(entry)[0]; if (a[key] < b[key]) return -1; if (a[key] > b[key]) return 1; } return 0; }).slice(0, query.take);
    } }])) };
  };
  const transactions = { async read(callback) { calls.db++; await hooks.db?.(calls.db); insideDb = true; try { return await callback(tx()); } finally { insideDb = false; } } };
  const walk = async (path, prefix = '') => {
    const files = [];
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const key = prefix + entry.name;
      if (entry.isDirectory()) files.push(...await walk(join(path, entry.name), key + '/')); else files.push(key);
    }
    return files.sort();
  };
  const store = {
    prefix: 'test', storageScopeSha256: restoreMediaDigest({ accountId: '0'.repeat(32), bucket: 'isolated-fixture', prefix: 'test' }),
    async list(cursor, signal) {
      assert.equal(insideDb, false); signal.throwIfAborted(); calls.list++; await hooks.list?.(calls.list);
      const keys = (await walk(directory)).filter(key => key.startsWith('test/') && (cursor === null || key > cursor));
      const page = keys.slice(0, 1);
      const objects = await Promise.all(page.map(async key => { const bytes = await readFile(join(directory, key)), metadata = await stat(join(directory, key)); return { key, bytes: bytes.length, etag: sha(bytes), modified: metadata.mtime.toISOString() }; }));
      return { objects, next: keys.length > page.length ? page.at(-1) : null };
    },
    async read(key, signal) {
      assert.equal(insideDb, false); signal.throwIfAborted(); calls.read++; await hooks.read?.(key);
      const bytes = await readFile(join(directory, key));
      const stream = createReadStream(join(directory, key), { highWaterMark: 16 }); streams.push(stream);
      return { stream, bytes: bytes.length, etag: sha(bytes) };
    },
  };
  const service = new RestoreMediaService(transactions, new RestoreMediaRepository(), store, { ...RESTORE_MEDIA_MAXIMUMS, ...limits });
  return { directory, snapshot, store, service, hooks, calls, streams, transactions, tx, put, assetId, ownerId,
    reconcile: () => service.reconcile(new AbortController().signal), bind: evidence => transactions.read(tx => service.bind(tx, evidence)) };
}
