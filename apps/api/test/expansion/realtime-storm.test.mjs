import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { io } from 'socket.io-client';
import { createUser, createRoom, assignRoomOwner, joinRoom } from '../support/domain-fixture.mjs';
import { newIntentScope } from '../support/membership-scope-fixture.mjs';
import { SessionService } from '../../dist/modules/auth/session.service.js';
import { SessionRepository } from '../../dist/modules/auth/session.repository.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { child, unusedPort, waitFor, stopChild } from '../helpers.mjs';
import { isolated, batches, distribution, evidence } from '../quality/evidence.mjs';
import { HTTP_CONNECTION_LIMIT, REALTIME_CONNECTION_LIMIT } from '../../dist/common/http/connection-budget.js';

test('single-event fanout characterization and 1000-client automatic reconnect storm with per-client REST recovery', { timeout: 240000 }, async t => {
  isolated();
  const db = new MysqlDatabase(readConfig('api')), people = [], processes = [];
  const directory = await mkdtemp(join(tmpdir(), 'rogi-m12-storm-'));
  const key = randomBytes(32), authFile = join(directory, 'auth.json');
  await writeFile(authFile, JSON.stringify({ key: key.toString('hex') }), { mode: 0o600 });
  const sessions = new SessionService(new SessionRepository(), 'rogi-test', key);
  const ports = [await unusedPort(), await unusedPort()];
  let phase = 'initial', sendStarted, restartStarted;
  const hintTimes = new Map(), projectionTimes = new Map(), recoveryTimes = new Map(), errors = [];
  t.after(async () => {
    phase = 'stopped';
    for (const person of people) person.socket?.disconnect();
    for (const instance of processes) await stopChild(instance);
    await db.close(); await rm(directory, { recursive: true, force: true });
  });
  const room = await db.transactions.write(tx => createRoom(tx, 'M12 automatic storm', 'GROUP'));
  for (let index = 0; index < 1000; index++) people.push(await db.transactions.write(async tx => {
    const id = await createUser(tx, `M12 storm ${index}`);
    await tx.prisma.platform_soop.create({ data: { id: randomUUID(), user_id: id, provider_subject: randomBytes(24), verified_at: await tx.now() } });
    const actor = await joinRoom(tx, room, id);
    if (!index) await assignRoomOwner(tx, room, actor);
    return { id, ...await sessions.issue(tx, id), node: index % 2, deviceId: randomUUID(), cacheId: randomUUID(),
      scope: await newIntentScope(tx, key, 'rogi-test', id, room), connectErrors: 0, reconnectAttempts: 0 };
  }));
  async function start(node) {
    const instance = child('api', { DATABASE_URL: process.env.DATABASE_URL, PORT: String(ports[node]), AUTH_SECRET_FILE: authFile });
    processes.push(instance); await waitFor(() => instance.output().includes('started'), 15000);
    assert.equal((await fetch(`http://127.0.0.1:${ports[node]}/ready`)).status, 200); return instance;
  }
  const apis = await Promise.all([start(0), start(1)]);
  const headers = person => ({ Origin: 'http://localhost:3001', Cookie: `rogi_session=${person.token}`, 'X-CSRF-Token': person.csrf, 'Content-Type': 'application/json' });
  const marker = 'M12 single event projection';
  let pendingFetches = 0;
  async function project(person, category, began) {
    pendingFetches++;
    try {
      const query = new globalThis.URLSearchParams({ deviceId: person.deviceId, cacheId: person.cacheId, limit: '10' });
      const response = await fetch(`http://127.0.0.1:${ports[person.node]}/v1/rooms/${room}/snapshot?${query}`, { headers: headers(person), signal: AbortSignal.timeout(15000) });
      if (response.status !== 200) { errors.push({ phase: category, status: response.status }); await response.arrayBuffer(); return; }
      const body = await response.json();
      if (body.messages.length !== 1 || body.messages[0].content.text !== marker) { errors.push({ phase: category, status: 'projection-mismatch' }); return; }
      const target = category === 'hint' ? projectionTimes : recoveryTimes;
      if (!target.has(person.id)) target.set(person.id, performance.now() - began);
    } catch { errors.push({ phase: category, status: 'transport-or-timeout' }); }
    finally { pendingFetches--; }
  }
  async function connect(person) {
    const socket = io(`http://127.0.0.1:${ports[person.node]}`, { path: '/v1/realtime', transports: ['websocket'],
      reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 5000, randomizationFactor: 0.5,
      timeout: 10000, extraHeaders: headers(person), auth: { schemaVersion: 1, csrfToken: person.csrf } });
    person.socket = socket;
    socket.io.on('reconnect_attempt', () => { if (phase === 'recovery') person.reconnectAttempts++; });
    socket.on('connect_error', () => { if (phase === 'recovery') person.connectErrors++; });
    socket.on('connect', () => { if (phase === 'recovery') void project(person, 'recovery', restartStarted); });
    socket.on('sync.required', value => {
      if (JSON.stringify(value) !== '{"schemaVersion":1}') { errors.push({ phase: 'hint', status: 'nonminimal-hint' }); return; }
      if (phase !== 'hint' || hintTimes.has(person.id)) return;
      hintTimes.set(person.id, performance.now() - sendStarted); void project(person, 'hint', sendStarted);
    });
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  }
  // Only initial population is paced. All later reconnection timing is the real
  // Socket.IO backoff, with no test batching, explicit connect() or retry sleeps.
  for (let offset = 0; offset < people.length; offset += 50) {
    await batches(people.slice(offset, offset + 50), 10, connect); await delay(1100);
  }
  assert.equal(people.filter(person => person.socket.connected).length, 1000);
  phase = 'hint'; sendStarted = performance.now();
  const response = await fetch(`http://127.0.0.1:${ports[0]}/v1/rooms/${room}/messages`, { method: 'POST', headers: headers(people[0]),
    body: JSON.stringify({ membershipScope: people[0].scope, clientMessageId: randomUUID(), intent: 'SHARED', content: { type: 'TEXT', text: marker } }) });
  assert.equal(response.status, 200); const ack = await response.json(); assert.equal(ack.status, 'committed');
  const ackMs = performance.now() - sendStarted;
  await waitFor(async () => await db.transactions.read(tx => tx.prisma.jobs.count({ where: { room_id: room, purpose: 'REALTIME_HINT', state: { in: ['PENDING', 'RUNNING'] } } })) === 0, 20000);
  await delay(1000); await waitFor(() => pendingFetches === 0, 20000);
  const recipients = [0, 1].map(node => people.filter(person => person.node === node && hintTimes.has(person.id)).length);
  // Record the actual single-event result before the independent storm. This
  // demonstrates the missing bus without confusing REST recovery with fanout.
  const fanout = { ackMs, recipientsPerProcess: recipients, hintRecipients: hintTimes.size, eligibleRecipients: 1000,
    crossNodeFanoutComplete: hintTimes.size === 1000,
    sendToHint: hintTimes.size ? distribution([...hintTimes.values()]) : null,
    sendToRestProjection: projectionTimes.size ? distribution([...projectionTimes.values()]) : null,
    projectionSuccesses: projectionTimes.size, projectionErrors: errors.filter(error => error.phase === 'hint') };
  await evidence('single-event-fanout', { outcome: 'measured', ...fanout,
    limitations: ['only the API that claims the single durable hint job dispatches to its local sockets', 'REST projection is not a rendered UI measurement'] });
  phase = 'recovery'; restartStarted = performance.now();
  for (const instance of apis) assert.equal(instance.proc.kill('SIGKILL'), true);
  for (const instance of apis) assert.deepEqual(await instance.exited, [null, 'SIGKILL']);
  const restartedApis = await Promise.all([start(0), start(1)]);
  // Observe all outcomes up to 45s, but retain the original 20s acceptance gate.
  // A miss is measured and then fails; the observation timeout never raises the target.
  await waitFor(() => recoveryTimes.size === 1000 || (people.every(person => person.socket.connected) && pendingFetches === 0), 45000).catch(() => {});
  const recovery = recoveryTimes.size ? distribution([...recoveryTimes.values()]) : null;
  const missedDeadline = 1000 - [...recoveryTimes.values()].filter(ms => ms <= 20000).length;
  await evidence('automatic-reconnect', { outcome: missedDeadline === 0 ? 'passed' : 'failed', concurrentSockets: 1000,
    killedApiProcesses: 2, recoveredProjections: recoveryTimes.size, connectedSockets: people.filter(person => person.socket.connected).length,
    recoveryFromSigkill: recovery, deadlineMs: 20000, clientsMissingDeadline: missedDeadline,
    connectErrors: people.reduce((total, person) => total + person.connectErrors, 0),
    reconnectAttempts: people.reduce((total, person) => total + person.reconnectAttempts, 0),
    backoff: { initialMs: 1000, maximumMs: 5000, randomizationFactor: 0.5 },
    recoveryErrors: errors.filter(error => error.phase === 'recovery'),
    limitations: ['default-style Socket.IO client plus immediate REST snapshot, not browser rendering', 'same-host runner, no WAN or load balancer'] });
  // The shipped MVP has a single serving API. Check its REST headroom at the
  // configured gateway bound as well as the exploratory two-process design.
  phase = 'capacity';
  const moving = people.filter(person => person.node === 1);
  for (const person of moving) { person.socket.disconnect(); person.node = 0; }
  await stopChild(restartedApis[1]);
  for (let offset = 0; offset < moving.length; offset += 50) {
    await batches(moving.slice(offset, offset + 50), 10, person => connect(person).catch(() => {})); await delay(1100);
  }
  await waitFor(() => people.every(person => person.socket.connected), 20000).catch(() => {});
  let readinessStatus = null, transportRejected = false;
  try {
    const readiness = await fetch(`http://127.0.0.1:${ports[0]}/ready`, { signal: AbortSignal.timeout(3000) });
    readinessStatus = readiness.status; await readiness.arrayBuffer();
  } catch { transportRejected = true; }
  const singleApiSockets = people.filter(person => person.socket.connected).length;
  await evidence('single-api-capacity', { outcome: singleApiSockets === 1000 && readinessStatus === 200 ? 'passed' : 'failed',
    connectedSockets: singleApiSockets, readinessStatus, transportRejected,
    configuredHttpMaxConnections: HTTP_CONNECTION_LIMIT, configuredRealtimeMaxConnections: REALTIME_CONNECTION_LIMIT,
    limitation: 'same-host synthetic connection-bound probe, not production capacity certification' });
  assert.equal(recoveryTimes.size, 1000, 'every automatically reconnected client must recover the committed projection');
  assert.equal(missedDeadline, 0, 'each foreground recovery must meet the unchanged 20-second gate');
  assert.equal(errors.length, 0, 'hint and reconnect projection requests must not fail');
  assert.equal(hintTimes.size, 500, 'characterize the known node-local single-job fanout gap rather than claim cross-node delivery');
  assert.equal(projectionTimes.size, 500);
  assert.ok(fanout.sendToRestProjection.p95Ms <= 1000, 'supported local recipients must meet the 1-second REST projection comparison');
  assert.equal(singleApiSockets, 1000);
  assert.equal(readinessStatus, 200, 'single serving API must retain REST capacity while 1000 realtime clients are connected');
});
