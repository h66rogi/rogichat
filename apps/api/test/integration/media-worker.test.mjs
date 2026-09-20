import { createUser, createRoom, joinRoom, reserveMedia, beginUpload, finishUpload, failUpload, prepareMedia, processMedia, recoverMedia, enqueueJob } from '../support/domain-fixture.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';

const MiB = 1024 * 1024;
const inputBytes = Buffer.alloc(128, 1);
const outputBytes = Buffer.from('synthetic-output');
const hash = 'b'.repeat(64);
const barrier = () => { let resolve; return { wait: new Promise(done => { resolve = done; }), release: () => resolve() }; };

async function fixture(t) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const db = new MysqlDatabase(readConfig('api')); t.after(() => db.close());
  const txs = db.transactions;
  const userId = await txs.write(async tx => {
    const id = await createUser(tx, '미디어 워커 합성 사용자');
    await tx.execute('INSERT INTO platform_soop (id,user_id,provider_subject,verified_at) VALUES (?,?,?,UTC_TIMESTAMP(3))', [randomUUID(), id, Buffer.from(`worker-fixture-${randomUUID()}`)]);
    return id;
  });
  const roomId = await txs.write(async tx => { const id = await createRoom(tx, '미디어 워커 합성방', 'GROUP'); await joinRoom(tx, id, userId); return id; });
  // Only DB fencing/atomicity is under test. Neither map storage nor synthetic decoder
  // proves real R2 access, valid encoded pixels or container decoder isolation.
  const objects = new Map(); const calls = { put: [], remove: [], read: [], decode: 0, dispose: 0 };
  const hooks = {};
  const store = {
    async read(key, signal) { assert.equal(signal.aborted, false); calls.read.push(key); const body = objects.get(key); assert.ok(body); return { stream: Readable.from([body]), bytes: body.length }; },
    async put(key, path, bytes, contentType, signal) {
      assert.equal(signal.aborted, false); assert.equal(path, 'synthetic-memory-file');
      assert.equal(bytes, outputBytes.length); assert.equal(contentType, 'image/webp'); assert.equal(objects.has(key), false);
      calls.put.push(key); objects.set(key, outputBytes); await hooks.put?.(key);
    },
    async remove(key, signal) { assert.equal(signal.aborted, false); calls.remove.push(key); await hooks.remove?.(key); objects.delete(key); },
    async signedGet() { throw new Error('not-used'); },
  };
  const decoder = { async decode(stream, input, signal) {
    assert.equal(signal.aborted, false); let bytes = 0; for await (const chunk of stream) bytes += chunk.length;
    assert.equal(bytes, input.byteLength); calls.decode++;
    return { width: 1, height: 1, contentType: 'image/webp', file: { path: 'synthetic-memory-file', bytes: outputBytes.length, sha256: hash, async dispose() { calls.dispose++; } } };
  } };
  const reserve = () => txs.write(tx => reserveMedia(tx, userId, roomId, { kind: 'PHOTO', contentType: 'image/jpeg', byteLength: inputBytes.length }));
  const uploading = async () => { const intent = await reserve(); const attempt = await txs.write(tx => beginUpload(tx, userId, intent.assetId, 'test')); objects.set(attempt.key, inputBytes); return attempt; };
  const processing = async () => { const attempt = await uploading(); await txs.write(tx => finishUpload(tx, userId, attempt, inputBytes.length, hash)); return attempt; };
  // Scope fixture lease acquisition to its own job; previous integration files intentionally
  // leave other MEDIA jobs. Generic queue claiming/renewal has separate real-MySQL tests.
  const lease = (assetId, jobId) => txs.write(async tx => {
    const [job] = await tx.rows("SELECT * FROM jobs WHERE purpose='MEDIA' AND resource_id=? AND (? IS NULL OR id=?) AND state IN ('PENDING','RUNNING') ORDER BY created_at,id LIMIT 1 FOR UPDATE", [assetId, jobId ?? null, jobId ?? null]);
    assert.ok(job); const generation = BigInt(job.generation) + 1n, owner = randomUUID(), token = randomUUID();
    await tx.execute("UPDATE jobs SET state='RUNNING',generation=?,lease_owner=?,lease_token=?,lease_until=TIMESTAMPADD(MINUTE,5,UTC_TIMESTAMP(3)),attempts=attempts+1 WHERE id=?", [String(generation), owner, token, job.id]);
    return { id: job.id, purpose: 'MEDIA', roomId: job.room_id, resourceId: assetId, generation, leaseOwner: owner, leaseToken: token, attempts: Number(job.attempts) + 1, maxAttempts: Number(job.max_attempts) };
  });
  const expire = job => txs.write(tx => tx.execute('UPDATE jobs SET lease_until=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)) WHERE id=?', [job.id]));
  const inspect = assetId => txs.read(async tx => ({
    asset: (await tx.rows('SELECT * FROM media_assets WHERE id=?', [assetId]))[0],
    objects: await tx.rows('SELECT * FROM media_objects WHERE asset_id=? ORDER BY created_at,id', [assetId]),
    jobs: await tx.rows("SELECT * FROM jobs WHERE resource_id=? AND purpose='MEDIA' ORDER BY created_at,id", [assetId]),
    reserved: BigInt((await tx.rows("SELECT reserved_bytes FROM media_budget WHERE id='global'"))[0].reserved_bytes),
  }));
  const age = assetId => txs.write(async tx => {
    await tx.execute('UPDATE media_assets SET upload_until=TIMESTAMPADD(MINUTE,-30,UTC_TIMESTAMP(3)) WHERE id=?', [assetId]);
    await tx.execute('UPDATE media_objects SET created_at=TIMESTAMPADD(MINUTE,-30,UTC_TIMESTAMP(3)) WHERE asset_id=?', [assetId]);
  });
  const processJob = job => processMedia(txs, store, decoder, 'test', job);
  return { db, txs, userId, roomId, reserve, uploading, processing, lease, expire, inspect, age, process: processJob, store, objects, calls, hooks };
}

test('worker commits READY object, asset and job atomically; a completed retry has no external effect', { timeout: 20000 }, async t => {
  const f = await fixture(t); const attempt = await f.processing(); const lease = await f.lease(attempt.assetId);
  const before = await f.inspect(attempt.assetId);
  assert.equal(await f.process(lease), 'completed');
  const after = await f.inspect(attempt.assetId);
  assert.equal(after.asset.state, 'READY'); assert.equal(after.reserved, before.reserved);
  assert.equal(after.jobs[0].state, 'COMPLETED'); assert.equal(after.jobs[0].lease_token, null);
  const ready = after.objects.filter(object => object.state === 'READY'); assert.equal(ready.length, 1);
  assert.equal(ready[0].variant, 'image'); assert.equal(Number(ready[0].byte_length), outputBytes.length); assert.equal(ready[0].sha256, hash);
  assert.equal(f.calls.decode, 1); assert.equal(f.calls.dispose, 1);
  // The already consumed lease must not reprocess nor claim success from a stale fence.
  assert.equal(await f.process(lease), 'lease_lost'); assert.equal(f.calls.put.length, 1); assert.equal(f.calls.read.length, 1);
});

test('expired finalization rolls back READY, and a reclaimed immutable attempt reserves an additional output cap', { timeout: 20000 }, async t => {
  const f = await fixture(t); const attempt = await f.processing(); const first = await f.lease(attempt.assetId);
  const before = await f.inspect(attempt.assetId);
  f.hooks.put = () => f.expire(first);
  assert.equal(await f.process(first), 'lease_lost');
  let saved = await f.inspect(attempt.assetId);
  assert.equal(saved.asset.state, 'PROCESSING'); assert.equal(saved.objects.filter(object => object.variant === 'image')[0].state, 'ALLOCATED');
  assert.equal(saved.jobs[0].state, 'RUNNING'); assert.equal(saved.reserved, before.reserved); assert.equal(f.calls.dispose, 1);
  // A failed prepare fence rolls back both its new object and extra quota reservation.
  await assert.rejects(f.txs.write(tx => prepareMedia(tx, first, 'test')));
  saved = await f.inspect(attempt.assetId); assert.equal(saved.objects.length, 2); assert.equal(saved.reserved, before.reserved);
  const second = await f.lease(attempt.assetId, first.id); delete f.hooks.put;
  assert.equal(await f.process(second), 'completed');
  saved = await f.inspect(attempt.assetId);
  assert.equal(saved.asset.state, 'READY'); assert.equal(saved.reserved - before.reserved, BigInt(10 * MiB));
  assert.equal(BigInt(saved.asset.reserved_bytes) - BigInt(before.asset.reserved_bytes), BigInt(10 * MiB));
  const outputs = saved.objects.filter(object => object.variant === 'image');
  assert.equal(outputs.length, 2); assert.equal(outputs.filter(object => object.state === 'READY').length, 1);
  assert.notEqual(outputs[0].object_key, outputs[1].object_key); assert.equal(new Set(f.calls.put).size, 2);
  assert.equal(f.calls.dispose, 2);
});

test('two concurrent MEDIA jobs use current object reads after an older owner-reference snapshot and reserve every attempt', { timeout: 20000 }, async t => {
  const f = await fixture(t); const attempt = await f.processing(); const first = await f.lease(attempt.assetId);
  const secondId = await f.txs.write(tx => enqueueJob(tx, { purpose: 'MEDIA', resourceId: attempt.assetId }));
  const second = await f.lease(attempt.assetId, secondId); const before = await f.inspect(attempt.assetId);
  const locked = barrier(), unlock = barrier(), snapshots = [barrier(), barrier()];
  const holder = f.txs.write(async tx => { await tx.rows('SELECT id FROM users WHERE id=? FOR UPDATE', [f.userId]); locked.release(); await unlock.wait; });
  await locked.wait;
  const attempts = [first, second].map((lease, index) => f.txs.write(async tx => {
    const query = tx.prisma.media_assets.findMany.bind(tx.prisma.media_assets);
    tx.prisma.media_assets.findMany = async input => {
      const result = await query(input);
      if (input.select?.owner_user_id && Object.keys(input.select).length === 1) snapshots[index].release();
      return result;
    };
    return prepareMedia(tx, lease, 'test');
  }));
  try { await Promise.all(snapshots.map(snapshot => snapshot.wait)); }
  finally { unlock.release(); await holder; }
  const prepared = await Promise.all(attempts);
  assert.ok(prepared.every(value => typeof value === 'object'));
  assert.notEqual(prepared[0].key, prepared[1].key);
  const after = await f.inspect(attempt.assetId);
  assert.equal(after.objects.filter(object => object.variant === 'image').length, 2);
  assert.equal(after.reserved - before.reserved, BigInt(10 * MiB));
  assert.equal(BigInt(after.asset.reserved_bytes) - BigInt(before.asset.reserved_bytes), BigInt(10 * MiB));
});

test('owner deletion committed during external PUT wins READY race; young objects defer cleanup without freeing quota', { timeout: 20000 }, async t => {
  const f = await fixture(t); const attempt = await f.processing(); const lease = await f.lease(attempt.assetId);
  const entered = barrier(), resume = barrier(); f.hooks.put = async () => { entered.release(); await resume.wait; };
  const running = f.process(lease); await entered.wait;
  try { await f.txs.write(tx => tx.execute("UPDATE users SET status='DELETING' WHERE id=?", [f.userId])); }
  finally { resume.release(); }
  await assert.rejects(running, { code: 'SOURCE_UNAVAILABLE' });
  const before = await f.inspect(attempt.assetId); assert.equal(before.asset.state, 'PROCESSING'); assert.equal(before.objects.some(object => object.state === 'READY'), false);
  assert.equal(f.calls.dispose, 1);
  delete f.hooks.put;
  assert.equal(await f.process(lease), 'completed');
  const after = await f.inspect(attempt.assetId);
  assert.equal(after.asset.state, 'DELETING'); assert.equal(after.reserved, before.reserved); assert.equal(f.calls.remove.length, 0);
  assert.equal(after.jobs.filter(job => job.state === 'PENDING').length, 1);
  assert.equal(after.jobs.filter(job => job.state === 'COMPLETED').length, 1);
});

test('external deletion failure retains reservation; successful cleanup releases it once and atomically completes the job', { timeout: 20000 }, async t => {
  const f = await fixture(t); const attempt = await f.processing(); const first = await f.lease(attempt.assetId);
  f.hooks.put = () => f.expire(first); assert.equal(await f.process(first), 'lease_lost'); delete f.hooks.put;
  await f.txs.write(tx => tx.execute("UPDATE media_assets SET state='DELETING',deleted_at=UTC_TIMESTAMP(3) WHERE id=?", [attempt.assetId]));
  await f.age(attempt.assetId); const lease = await f.lease(attempt.assetId, first.id); const before = await f.inspect(attempt.assetId);
  let removals = 0; f.hooks.remove = () => { if (++removals === 2) throw new Error('synthetic-storage-unavailable'); };
  await assert.rejects(f.process(lease), /synthetic-storage-unavailable/);
  let after = await f.inspect(attempt.assetId);
  assert.equal(after.reserved, before.reserved); assert.equal(after.asset.state, 'DELETING'); assert.equal(after.objects.some(object => object.state === 'DELETED'), false);
  assert.equal(after.jobs[0].state, 'RUNNING');
  delete f.hooks.remove; assert.equal(await f.process(lease), 'completed');
  after = await f.inspect(attempt.assetId);
  assert.equal(after.asset.state, 'DELETED'); assert.equal(BigInt(after.asset.reserved_bytes), 0n);
  assert.equal(before.reserved - after.reserved, BigInt(before.asset.reserved_bytes)); assert.ok(after.objects.every(object => object.state === 'DELETED'));
  assert.equal(after.jobs[0].state, 'COMPLETED'); assert.equal(f.objects.size, 0);
  assert.equal(await f.process(lease), 'lease_lost'); assert.equal((await f.inspect(attempt.assetId)).reserved, after.reserved);
});

test('cleanup with an expired completion fence cannot release quota after external DELETE; a fresh lease recovers safely', { timeout: 20000 }, async t => {
  const f = await fixture(t); const attempt = await f.uploading();
  await f.txs.write(tx => failUpload(tx, attempt)); await f.age(attempt.assetId);
  const first = await f.lease(attempt.assetId); const before = await f.inspect(attempt.assetId);
  f.hooks.remove = () => f.expire(first);
  assert.equal(await f.process(first), 'lease_lost');
  let after = await f.inspect(attempt.assetId);
  assert.equal(after.asset.state, 'DELETING'); assert.equal(after.objects[0].state, 'ALLOCATED'); assert.equal(after.reserved, before.reserved);
  assert.equal(f.objects.size, 0); // Physical deletion is idempotent, DB reservation remains conservative.
  delete f.hooks.remove; const second = await f.lease(attempt.assetId, first.id);
  assert.equal(await f.process(second), 'completed');
  after = await f.inspect(attempt.assetId); assert.equal(after.asset.state, 'DELETED');
  assert.equal(before.reserved - after.reserved, BigInt(before.asset.reserved_bytes));
});

test('restart recovery fences expired UPLOADING and abandoned RESERVED assets without releasing quota or duplicating jobs', { timeout: 20000 }, async t => {
  const f = await fixture(t); const attempt = await f.uploading(); const reserved = await f.reserve();
  await f.txs.write(async tx => {
    await tx.execute('UPDATE media_assets SET upload_until=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)) WHERE id=?', [attempt.assetId]);
    await tx.execute('UPDATE media_assets SET expires_at=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)) WHERE id=?', [reserved.assetId]);
  });
  const before = await f.inspect(attempt.assetId);
  // Other integration fixtures may also be recoverable. The scanner is bounded at 20,
  // so make this fixture oldest without deleting or mutating the other assets.
  await f.txs.write(tx => tx.execute("UPDATE media_assets SET created_at='2000-01-01 00:00:00.000' WHERE id IN (?,?)", [attempt.assetId, reserved.assetId]));
  await f.txs.write(recoverMedia); await f.txs.write(recoverMedia);
  const a = await f.inspect(attempt.assetId), b = await f.inspect(reserved.assetId);
  assert.equal(a.asset.state, 'DELETING'); assert.equal(b.asset.state, 'DELETING'); assert.equal(a.reserved, before.reserved);
  assert.equal(a.jobs.length, 1); assert.equal(b.jobs.length, 1); assert.equal(a.objects[0].object_key, attempt.key);
  await assert.rejects(f.txs.write(tx => finishUpload(tx, f.userId, attempt, inputBytes.length, hash)), { code: 'MEDIA_STATE' });
});

test('recovery retains an expired current avatar but cleans unreferenced and explicitly deleted avatars', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const avatar = await f.txs.write(tx => reserveMedia(tx, f.userId, null, { kind: 'AVATAR', contentType: 'image/png', byteLength: inputBytes.length }));
  const abandoned = await f.txs.write(tx => reserveMedia(tx, f.userId, null, { kind: 'AVATAR', contentType: 'image/png', byteLength: inputBytes.length }));
  await f.txs.write(async tx => {
    // Synthetic READY only isolates reference-retention from pixel decoding.
    await tx.execute("UPDATE media_assets SET state='READY',expires_at=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)),created_at='1980-01-01 00:00:00.000' WHERE id IN (?,?)", [avatar.assetId, abandoned.assetId]);
    await tx.execute('UPDATE user_profiles SET avatar_asset_id=? WHERE user_id=?', [avatar.assetId, f.userId]);
  });
  const before = await f.inspect(avatar.assetId);
  await f.txs.write(recoverMedia);
  let retained = await f.inspect(avatar.assetId);
  assert.equal(retained.asset.state, 'READY'); assert.equal(retained.jobs.length, 0);
  assert.equal((await f.inspect(abandoned.assetId)).asset.state, 'DELETING');
  assert.equal(retained.reserved, before.reserved);
  // A retained historical FK cannot defeat a deliberate deletion request.
  await f.txs.write(tx => tx.execute("UPDATE media_assets SET state='DELETING',deleted_at=UTC_TIMESTAMP(3) WHERE id=?", [avatar.assetId]));
  await f.txs.write(recoverMedia);
  retained = await f.inspect(avatar.assetId);
  assert.equal(retained.asset.state, 'DELETING'); assert.equal(retained.jobs.length, 1);
  assert.equal(retained.reserved, before.reserved);
});

test('an earlier consistent snapshot cannot let recovery delete a newly attached avatar', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const avatar = await f.txs.write(tx => reserveMedia(tx, f.userId, null, { kind: 'AVATAR', contentType: 'image/png', byteLength: inputBytes.length }));
  await f.txs.write(tx => tx.execute("UPDATE media_assets SET state='READY',expires_at=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)),created_at='1981-01-01 00:00:00.000' WHERE id=?", [avatar.assetId]));
  const snapshot = barrier(), attached = barrier();
  const recovery = f.txs.write(async tx => {
    await tx.rows('SELECT avatar_asset_id FROM user_profiles WHERE user_id=?', [f.userId]);
    snapshot.release(); await attached.wait;
    await recoverMedia(tx);
  });
  await snapshot.wait;
  try {
    await f.txs.write(async tx => {
      await tx.rows('SELECT id FROM media_assets WHERE id=? FOR UPDATE', [avatar.assetId]);
      await tx.execute('UPDATE user_profiles SET avatar_asset_id=? WHERE user_id=?', [avatar.assetId, f.userId]);
    });
  } finally { attached.release(); }
  await recovery;
  const retained = await f.inspect(avatar.assetId);
  assert.equal(retained.asset.state, 'READY'); assert.equal(retained.jobs.length, 0);
});

test('recovery skips twenty old queued or epoch-exhausted deletions and defers processing only until its live lease expires', { timeout: 20000 }, async t => {
  const f = await fixture(t); const expired = await f.uploading(); const processing = await f.processing();
  const active = await f.lease(processing.assetId);
  const oldAssets = [];
  await f.txs.write(async tx => {
    // Synthetic zero-reservation cleanup rows only exercise scheduling; no R2 bytes exist.
    for (let index = 0; index < 20; index++) {
      const assetId = randomUUID(); oldAssets.push(assetId);
      await tx.execute("INSERT INTO media_assets (id,owner_user_id,room_id,kind,content_type,state,declared_bytes,reserved_bytes,expires_at,created_at,deleted_at) VALUES (?,?,?,'PHOTO','image/jpeg','DELETING',1,0,UTC_TIMESTAMP(3),'1990-01-01 00:00:00.000',UTC_TIMESTAMP(3))", [assetId, f.userId, f.roomId]);
      const jobId = await enqueueJob(tx, { purpose: 'MEDIA', resourceId: assetId });
      if (index >= 7 && index < 14) {
        await tx.execute("UPDATE jobs SET state='RUNNING',generation=1,lease_owner=?,lease_token=?,lease_until=TIMESTAMPADD(MINUTE,5,UTC_TIMESTAMP(3)) WHERE id=?", [randomUUID(), randomUUID(), jobId]);
      } else if (index >= 14) {
        await tx.execute("UPDATE jobs SET state='FAILED',attempts=max_attempts,dedupe_key=UNHEX(SHA2(CONCAT('media-recovery:',?,':',DATE_FORMAT(UTC_TIMESTAMP(3),'%Y%m%d%H')),256)) WHERE id=?", [assetId, jobId]);
      }
    }
    await tx.execute("UPDATE media_assets SET upload_until=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)),created_at='2001-01-01 00:00:00.000' WHERE id=?", [expired.assetId]);
    await tx.execute("UPDATE media_assets SET expires_at=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)),created_at='2001-01-01 00:00:00.000' WHERE id=?", [processing.assetId]);
  });
  const before = await f.inspect(expired.assetId);
  await f.txs.write(recoverMedia);
  let recovered = await f.inspect(expired.assetId);
  assert.equal(recovered.asset.state, 'DELETING'); assert.equal(recovered.jobs.length, 1); assert.equal(recovered.reserved, before.reserved);
  assert.equal((await f.inspect(processing.assetId)).asset.state, 'PROCESSING');
  const [oldJobs] = await f.txs.read(tx => tx.rows(`SELECT COUNT(*) AS n FROM jobs WHERE purpose='MEDIA' AND resource_id IN (${oldAssets.map(() => '?').join(',')})`, oldAssets));
  assert.equal(Number(oldJobs.n), 20);
  await f.expire(active); await f.txs.write(recoverMedia);
  recovered = await f.inspect(processing.assetId);
  assert.equal(recovered.asset.state, 'DELETING'); assert.equal(recovered.jobs.length, 2); assert.equal(recovered.reserved, before.reserved);
});
