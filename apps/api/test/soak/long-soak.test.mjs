import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { io } from 'socket.io-client';
import sharp from 'sharp';
import { ReferenceRoomCache, syncPolicy } from '../../../../packages/contracts/sync-client.mjs';
import { createUser, createRoom, joinRoom, assignRoomOwner, reserveMedia, beginUpload, finishUpload } from '../support/domain-fixture.mjs';
import { newIntentScope } from '../support/membership-scope-fixture.mjs';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { child, stopChild, unusedPort, waitFor } from '../helpers.mjs';
import { isolated, evidence, distribution } from '../quality/evidence.mjs';
import { DiskStore } from './disk-store.mjs';
const exec = promisify(execFile);
const DURATION = 30 * 60 * 1000, COMMANDS = 1800;

test('MVP: ten clients, thirty minutes at one message/sec with real video and process failures', { timeout: 35 * 60 * 1000 }, async t => {
  isolated();
  const directory = await mkdtemp('/tmp/rg-m12-soak-'), objects = join(directory, 'objects'), spool = join(directory, 'spool'), decoderDir = join(directory, 'decoder');
  for (const path of [objects, spool, decoderDir]) await mkdir(path, { mode: 0o700 });
  const db = new MysqlDatabase(readConfig('api')), key = randomBytes(32), authFile = join(directory, 'auth.json'), socketPath = join(directory, 's');
  await writeFile(authFile, JSON.stringify({ key: key.toString('hex') }), { mode: 0o600 });
  const sessions = new SessionService(new SessionRepository(), 'rogi-test', key), people = [], processes = [], intervals = [];
  let stopping = false, videoActive = false, crashArmed = false, workerCrashAt, workerRecoveryMs, worker, restartAt, restarting = false;
  const frames = [], errors = [], videoAssets = [], commands = new Map(), ackTimes = [], projectionTimes = [], videoAcks = [], videoProjections = [], scheduleLag = [], resourceSamples = [];
  t.after(async () => {
    stopping = true; for (const timer of intervals) clearInterval(timer);
    for (const p of people) p.socket?.disconnect();
    for (const proc of processes.toReversed()) await stopChild(proc);
    await db.close(); await rm(directory, { recursive: true, force: true });
  });
  const room = await db.transactions.write(tx => createRoom(tx, 'M12 disposable thirty minute room', 'GROUP'));
  for (let i = 0; i < 10; i++) people.push(await db.transactions.write(async tx => {
    const id = await createUser(tx, `M12 soak synthetic ${i}`);
    await tx.prisma.platform_soop.create({ data: { id: randomUUID(), user_id: id, provider_subject: Buffer.from(`m12-${randomUUID()}`), verified_at: await tx.now() } });
    const actor = await joinRoom(tx, room, id); if (!i) await assignRoomOwner(tx, room, actor);
    const cacheId = randomUUID();
    return { id, ...await sessions.issue(tx, id), scope: await newIntentScope(tx, key, 'rogi-test', id, room),
      deviceId: randomUUID(), cacheId, cache: new ReferenceRoomCache(cacheId), seen: new Set(), busy: false, dirty: false };
  }));
  const port = await unusedPort(), base = `http://127.0.0.1:${port}`;
  async function startApi() {
    const instance = child('api', { DATABASE_URL: process.env.DATABASE_URL, PORT: String(port), AUTH_SECRET_FILE: authFile });
    processes.push(instance); await waitFor(() => instance.output().includes('started'), 15000);
    assert.equal((await fetch(`${base}/ready`)).status, 200); return instance;
  }
  let api = await startApi();
  function fixtureChild(file, args, env) {
    const proc = spawn(process.execPath, [file, ...args], { env, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    const instance = { proc, exited: once(proc, 'exit'), output: () => '' }; let ready = false;
    proc.on('message', frame => { if (frame.type === 'ready') ready = true; });
    processes.push(instance); return { instance, ready: () => ready };
  }
  const decoder = fixtureChild('test/soak/decoder-child.mjs', [decoderDir, socketPath], { PATH: process.env.PATH, LANG: 'C.UTF-8' });
  await waitFor(decoder.ready, 15000);
  async function startWorker() {
    const result = fixtureChild('test/soak/worker-child.mjs', [spool, socketPath, objects], {
      PATH: process.env.PATH, NODE_ENV: 'test', APP_ENV: 'test', DB_TLS_MODE: 'disabled',
      DATABASE_URL: process.env.DATABASE_URL, ROGICHAT_TEST_MYSQL: 'disposable',
    });
    result.instance.proc.on('message', frame => {
      frames.push({ ...frame, atMs: performance.now() });
      if (frame.type === 'decode-start') {
        videoActive = true;
        if (crashArmed) {
          crashArmed = false;
          setTimeout(() => {
            workerCrashAt = performance.now(); videoActive = false; result.instance.proc.kill('SIGKILL');
            void result.instance.exited.then(() => startWorker()).then(value => { worker = value; }).catch(() => errors.push({ phase: 'worker-restart' }));
          }, 250);
        }
      }
      if (frame.type === 'complete') {
        videoActive = false;
        if (workerCrashAt && !workerRecoveryMs) workerRecoveryMs = performance.now() - workerCrashAt;
      }
      if (frame.type === 'job-error') errors.push({ phase: 'video-job', code: frame.code });
    });
    await waitFor(result.ready, 15000); return result.instance;
  }
  worker = await startWorker();
  const input = join(directory, 'synthetic.mp4');
  await exec('/usr/bin/ffmpeg', ['-v', 'error', '-nostdin', '-n', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '20', '-c:v', 'libx264', '-threads', '1',
    '-preset', 'ultrafast', '-crf', '35', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', input], { timeout: 60000, maxBuffer: 65536 });
  const bytes = (await stat(input)).size, hash = createHash('sha256').update(await readFile(input)).digest('hex'), store = new DiskStore(objects);
  assert.ok(bytes < 20 * 1024 * 1024);
  async function video() {
    const intent = await db.transactions.write(tx => reserveMedia(tx, people[0].id, room, { kind: 'VIDEO', contentType: 'video/mp4', byteLength: bytes }));
    const attempt = await db.transactions.write(tx => beginUpload(tx, people[0].id, intent.assetId, 'test'));
    await store.put(attempt.key, input, bytes, 'video/mp4', AbortSignal.timeout(10000));
    await db.transactions.write(tx => finishUpload(tx, people[0].id, attempt, bytes, hash));
    videoAssets.push(attempt.assetId); return attempt.assetId;
  }
  async function readyVideo(id) { return db.transactions.read(async tx => (await tx.prisma.media_assets.findUnique({ where: { id }, select: { state: true } }))?.state === 'READY'); }
  // Fail early on decoder/storage/worker wiring; never spend thirty minutes before detecting a bad fixture.
  const preflight = await video(); await waitFor(() => readyVideo(preflight), 90000);
  const headers = p => ({ Origin: 'http://localhost:3001', Cookie: `rogi_session=${p.token}`, 'X-CSRF-Token': p.csrf, 'Content-Type': 'application/json' });
  async function sync(p) {
    if (stopping) return;
    p.dirty = true; if (p.busy) return;
    p.busy = true;
    try {
      while (p.dirty && !stopping) {
        p.dirty = false;
        const cursor = p.cache.state.cursor;
        const query = new globalThis.URLSearchParams({ deviceId: p.deviceId, cacheId: p.cacheId, limit: '100', ...(cursor ? { cursor } : {}) });
        const response = await fetch(`${base}/v1/rooms/${room}/${cursor ? 'events' : 'snapshot'}?${query}`, { headers: headers(p), signal: AbortSignal.timeout(10000) });
        assert.equal(response.status, 200); const body = await response.json();
        assert.equal(cursor ? p.cache.delta(p.cacheId, cursor, body) : p.cache.snapshot(p.cacheId, body), true);
        const visible = cursor ? body.events.filter(e => e.type === 'message.upsert').map(e => e.message) : body.messages;
        for (const message of visible) if (!p.seen.has(message.id)) {
          p.seen.add(message.id); const command = commands.get(message.content.text); assert.ok(command);
          const latency = performance.now() - command.at; projectionTimes.push(latency); if (videoActive) videoProjections.push(latency);
        }
        if (body.hasMore) p.dirty = true;
        if (restartAt && p.socket?.connected && !p.recoveryMs) p.recoveryMs = performance.now() - restartAt;
      }
    } catch (error) {
      errors.push({ phase: 'sync', expectedRestartWindow: Boolean(restartAt && performance.now() - restartAt < 20000), code: error.name });
    } finally { p.busy = false; }
  }
  for (const p of people) {
    await sync(p); assert.ok(p.cache.state.cursor);
    p.socket = io(base, { path: '/v1/realtime', transports: ['websocket'], reconnection: true,
      reconnectionDelay: 1000, reconnectionDelayMax: 5000, randomizationFactor: 0.5,
      extraHeaders: { Origin: 'http://localhost:3001', Cookie: `rogi_session=${p.token}` }, auth: { schemaVersion: 1, csrfToken: p.csrf } });
    p.socket.on('connect', () => { void sync(p); });
    p.socket.on('sync.required', value => { assert.deepEqual(value, { schemaVersion: 1 }); void sync(p); });
    p.socket.on('connect_error', () => errors.push({ phase: 'connect', expectedRestartWindow: Boolean(restartAt && performance.now() - restartAt < 20000) }));
  }
  await waitFor(() => people.every(p => p.socket.connected), 15000);
  intervals.push(setInterval(() => { for (const p of people) void sync(p); }, syncPolicy.foregroundMs));
  const start = performance.now(); crashArmed = true;
  async function restart() {
    restarting = true; restartAt = performance.now(); api.proc.kill('SIGKILL'); await api.exited;
    api = await startApi(); restarting = false;
  }
  let restartPromise;
  intervals.push(setInterval(() => {
    console.log(`M12_SOAK_PROGRESS ${JSON.stringify({ elapsedMs: performance.now() - start, acknowledged: ackTimes.length, projected: projectionTimes.length, videos: videoAssets.length })}`);
    for (const [role, proc] of [['api', api], ['worker', worker], ['decoder', decoder.instance]]) {
      void readFile(`/proc/${proc.proc.pid}/status`, 'utf8').then(value => {
        const highWaterKiB = Number(value.match(/^VmHWM:\s+(\d+)/m)?.[1]);
        if (highWaterKiB) resourceSamples.push({ role, highWaterKiB, elapsedMs: performance.now() - start });
      }).catch(() => {});
    }
  }, 60000));
  for (let index = 0; index < COMMANDS; index++) {
    await delay(Math.max(0, start + index * 1000 - performance.now()));
    scheduleLag.push(Math.max(0, performance.now() - start - index * 1000));
    if (index % 300 === 0) await video();
    if (index === 900) restartPromise = restart();
    const person = people[index % people.length], text = `M12-soak-${index}`, clientMessageId = randomUUID(), at = performance.now();
    commands.set(text, { at });
    const payload = JSON.stringify({ membershipScope: person.scope, clientMessageId, intent: 'SHARED', content: { type: 'TEXT', text } });
    for (;;) {
      try {
        const response = await fetch(`${base}/v1/rooms/${room}/messages`, { method: 'POST', headers: headers(person), body: payload, signal: AbortSignal.timeout(10000) });
        assert.equal(response.status, 200); const ack = await response.json(); assert.equal(ack.status, 'committed');
        commands.get(text).id = ack.messageId; const elapsed = performance.now() - at;
        ackTimes.push(elapsed); if (videoActive) videoAcks.push(elapsed); break;
      } catch (error) {
        const expected = Boolean(restartAt && performance.now() - restartAt < 20000);
        errors.push({ phase: 'send', expectedRestartWindow: expected, code: error.name });
        if (!expected) throw error;
        await delay(250);
      }
    }
  }
  await delay(Math.max(0, start + DURATION - performance.now())); await restartPromise;
  assert.equal(restarting, false);
  await Promise.all(people.map(sync));
  await waitFor(() => people.every(p => p.seen.size === COMMANDS), 20000);
  for (const id of videoAssets) await waitFor(() => readyVideo(id), 90000);
  const expectedIds = [...commands.values()].map(c => c.id).sort();
  for (const p of people) assert.deepEqual(p.cache.visible().map(m => m.id).sort(), expectedIds);
  const outputs = await db.transactions.read(tx => tx.prisma.media_objects.findMany({ where: { asset_id: { in: videoAssets }, state: 'READY', variant: { in: ['video', 'poster'] } }, select: { object_key: true, variant: true } }));
  assert.equal(outputs.length, videoAssets.length * 2);
  for (const output of outputs) {
    if (output.variant === 'video') {
      const { stdout } = await exec('/usr/bin/ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', store.path(output.object_key)], { maxBuffer: 65536 });
      const meta = JSON.parse(stdout); assert.deepEqual(meta.streams.map(s => s.codec_name), ['h264', 'aac']); assert.ok(Number(meta.format.duration) >= 20);
    } else assert.equal((await sharp(store.path(output.object_key)).metadata()).format, 'webp');
  }
  const unexpected = errors.filter(e => !e.expectedRestartWindow), recoveries = people.map(p => p.recoveryMs).filter(Number.isFinite);
  const report = { outcome: 'measured', durationMs: performance.now() - start, connections: people.filter(p => p.socket.connected).length,
    commands: ackTimes.length, projections: projectionTimes.length, ack: distribution(ackTimes), sendToCache: distribution(projectionTimes),
    videoOverlapAck: videoAcks.length ? distribution(videoAcks) : null, videoOverlapCache: videoProjections.length ? distribution(videoProjections) : null,
    clientRestartRecovery: recoveries.length ? distribution(recoveries) : null, completedVideos: videoAssets.length, videoInputBytes: bytes,
    killedWorkerRecoveryMs: workerRecoveryMs, workerFrames: frames, scheduleLag: distribution(scheduleLag), resourceSamples, errors,
    thresholds: { ackP95Ms: 500, syncP95Ms: 1000, everyClientRecoveryMs: 20000 },
    limitations: ['reference cache commit is not rendered browser latency', 'private disk fixture replaces R2; real native video decoder and real queue leases', 'same-host hosted runner; not production capacity certification', 'video upload admission uses real domain service fixture, not HTTP upload', 'RSS high-water samples exclude short-lived native decoder children'] };
  await evidence('mvp-thirty-minute-soak', report);
  assert.equal(unexpected.length, 0); assert.equal(ackTimes.length, 1800); assert.equal(projectionTimes.length, 18000);
  assert.ok(report.durationMs >= DURATION); assert.equal(report.connections, 10);
  assert.ok(report.ack.p95Ms <= 500); assert.ok(report.sendToCache.p95Ms <= 1000);
  assert.equal(recoveries.length, 10); assert.ok(Math.max(...recoveries) <= 20000);
  assert.ok(videoAcks.length > 0 && videoProjections.length > 0); assert.equal(videoAssets.length, 7);
  assert.ok(workerRecoveryMs > 0); assert.ok(frames.some(f => f.type === 'start' && BigInt(f.generation) > 1n));
});
