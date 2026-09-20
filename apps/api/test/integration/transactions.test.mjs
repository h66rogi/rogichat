import { createUser, createRoom, joinRoom, leaveRoom, nextOrder, consumeRate } from '../support/domain-fixture.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { MysqlDatabase } from '../../dist/infrastructure/database/database.js';
import { DatabaseUnavailableError } from '../../dist/infrastructure/database/database-unavailable.js';

const barrier = () => { let release; return { promise: new Promise(resolve => { release = resolve; }), release: () => release() }; };
// MySQL hides the detailed FK name from DML-only accounts (1216 vs 1452 with admin visibility).
const fkRejected = error => error.code === 'P2003' || error.meta?.driverAdapterError?.cause?.kind === 'ForeignKeyConstraintViolation' || [1216, 1452].includes(error.meta?.driverAdapterError?.cause?.code);

test('real single-connection pool exhaustion is classified without replay and recovers after release', { timeout: 15000 }, async t => {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL, 'disposable');
  const config = readConfig('api');
  const db = new MysqlDatabase({ ...config, database: { ...config.database, poolSize: 1 } });
  t.after(() => db.close());
  const locked = barrier(), unlock = barrier();
  const blocker = db.transactions.read(async tx => { await tx.rows('SELECT 1 AS value'); locked.release(); await unlock.promise; });
  let executed = 0;
  try {
    await locked.promise;
    await assert.rejects(db.transactions.write(async () => { executed++; }), error => error instanceof DatabaseUnavailableError && error.reason === 'database_acquisition');
    assert.equal(executed, 0);
  } finally { unlock.release(); await blocker; }
  assert.equal((await db.transactions.read(tx => tx.rows('SELECT 1 AS value')))[0].value, 1);
});

test('MySQL transaction boundaries, scoped FKs, concurrent membership, counters, snapshots and limiter', { timeout: 30000 }, async t => {
  const db = new MysqlDatabase(readConfig('api'));
  t.after(() => db.close());
  const txs = db.transactions;
  const [fan, other, room, second] = await txs.write(async tx => [
    await createUser(tx, '테스트 팬'), await createUser(tx, '다른 팬'),
    await createRoom(tx, '첫 방', 'FAN'), await createRoom(tx, '두 번째 방', 'GROUP'),
  ]);
  assert.match(fan, /^[a-f0-9-]{14}4/);
  const members = await Promise.all([txs.write(tx => joinRoom(tx, room, fan)), txs.write(tx => joinRoom(tx, room, fan))]);
  assert.equal(members[0], members[1]);
  const [period] = await txs.read(tx => tx.rows('SELECT visible_from_order,policy_version,id FROM membership_periods WHERE member_id=?', [members[0]]));
  assert.equal(period.visible_from_order, '1');
  const otherMember = await txs.write(tx => joinRoom(tx, second, other));
  await assert.rejects(txs.write(tx => tx.execute('UPDATE rooms SET owner_member_id=? WHERE id=?', [otherMember, room])), fkRejected);
  const [stream] = await txs.read(tx => tx.rows('SELECT id FROM message_streams WHERE room_id=?', [second]));
  await assert.rejects(txs.write(tx => tx.execute('INSERT INTO stream_grants (id,room_id,stream_id,member_id) VALUES (?,?,?,?)', [randomUUID(), room, stream.id, members[0]])), fkRejected);
  await assert.rejects(txs.write(async tx => {
    await tx.execute('UPDATE room_members SET active_period_id=NULL WHERE id=?', [members[0]]);
    await tx.execute('UPDATE room_members SET active_period_id=? WHERE id=?', [period.id, otherMember]);
  }), fkRejected);

  const locked = barrier(); const unlock = barrier();
  const first = txs.write(async tx => { const n = await nextOrder(tx, room); locked.release(); await unlock.promise; return n; });
  await locked.promise;
  let secondCommitted = false;
  const next = txs.write(async tx => nextOrder(tx, room)).then(n => { secondCommitted = true; return n; });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(secondCommitted, false);
  unlock.release();
  assert.equal(await first, 2n); assert.equal(await next, 3n);
  await assert.rejects(txs.write(async tx => { assert.equal(await nextOrder(tx, room), 4n); throw new Error('rollback_fixture'); }), /rollback_fixture/);
  assert.equal(await txs.write(tx => nextOrder(tx, room)), 4n);

  await txs.read(async tx => {
    const [before] = await tx.rows('SELECT nickname FROM user_profiles WHERE user_id=?', [fan]);
    await txs.write(writer => writer.execute('UPDATE user_profiles SET nickname=? WHERE user_id=?', ['갱신됨', fan]));
    const [same] = await tx.rows('SELECT nickname FROM user_profiles WHERE user_id=?', [fan]);
    assert.equal(same.nickname, before.nickname);
    await assert.rejects(tx.execute('UPDATE users SET status=? WHERE id=?', ['SUSPENDED', fan]), /not_writable/);
    await assert.rejects(tx.rows('UPDATE users SET status=? WHERE id=?', ['SUSPENDED', fan]), error => error.meta?.driverAdapterError?.cause?.code === 1792);
  });
  assert.equal((await txs.read(tx => tx.rows('SELECT nickname FROM user_profiles WHERE user_id=?', [fan])))[0].nickname, '갱신됨');
  let escaped;
  await txs.read(async tx => { escaped = tx; });
  await assert.rejects(escaped.rows('SELECT 1'), /finished/);

  await txs.write(tx => tx.execute('UPDATE rooms SET history_policy=?,policy_version=2 WHERE id=?', ['ALL_AVAILABLE', room]));
  assert.equal(await txs.write(tx => joinRoom(tx, room, fan)), members[0]);
  assert.equal((await txs.read(tx => tx.rows('SELECT policy_version FROM membership_periods WHERE id=?', [period.id])))[0].policy_version, 1);
  await txs.write(tx => leaveRoom(tx, room, fan));
  await txs.write(tx => joinRoom(tx, room, fan));
  const periods = await txs.read(tx => tx.rows('SELECT visible_from_order,left_at FROM membership_periods WHERE member_id=? ORDER BY joined_at', [members[0]]));
  assert.equal(periods.length, 2); assert.ok(periods[0].left_at); assert.equal(periods[1].visible_from_order, '0');

  const key = randomBytes(32);
  const results = await Promise.all(Array.from({ length: 4 }, () => txs.write(tx => consumeRate(tx, key, 2, 60))));
  assert.equal(results.filter(Boolean).length, 2);
  await txs.write(tx => tx.execute('UPDATE rate_buckets SET expires_at=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)) WHERE key_digest=?', [key]));
  assert.equal(await txs.write(tx => consumeRate(tx, key, 2, 60)), true);
});

test('actual two-connection MySQL deadlock retries whole transaction within bounded attempts', { timeout: 15000 }, async t => {
  const db = new MysqlDatabase(readConfig('api')); t.after(() => db.close());
  const [a, b] = await db.transactions.write(async tx => [await createUser(tx, 'a'), await createUser(tx, 'b')]);
  const arrived = [barrier(), barrier()]; const attempts = [0, 0];
  const job = (index, first, second) => db.transactions.write(async tx => {
    attempts[index]++;
    await tx.rows('SELECT id FROM users WHERE id=? FOR UPDATE', [first]);
    if (attempts[index] === 1) { arrived[index].release(); await arrived[1-index].promise; }
    await tx.rows('SELECT id FROM users WHERE id=? FOR UPDATE', [second]);
    await tx.execute('UPDATE users SET membership_generation=membership_generation+1 WHERE id=?', [first]);
  });
  await Promise.all([job(0,a,b), job(1,b,a)]);
  assert.equal(attempts.reduce((a,b) => a+b), 3);
  const rows = await db.transactions.read(tx => tx.rows('SELECT membership_generation FROM users WHERE id IN (?,?)', [a,b]));
  assert.deepEqual(rows.map(x => x.membership_generation), ['1','1']);
});
