import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readConfig } from '../../dist/config.js';
import { MysqlDatabase } from '../../dist/database.js';
import { createRoom, createUser, joinRoom, collectExpiredRates } from '../../dist/repositories.js';
import { roomCommandRate } from '../../dist/rates.js';

test('two DB pools share burst/minute command limits and GC cannot refund a live bucket', async t => {
  const first = new MysqlDatabase(readConfig('api')); const second = new MysqlDatabase(readConfig('api'));
  t.after(async () => { await first.close(); await second.close(); });
  const key = randomBytes(32);
  const fixture = await first.transactions.write(async tx => {
    const user = await createUser(tx, 'rate fixture'); const room = await createRoom(tx, 'rate room', 'GROUP');
    await joinRoom(tx, room, user); return { user, room };
  });
  const calls = await Promise.all(Array.from({ length: 10 }, (_, index) => (index % 2 ? first : second).transactions.write(tx => roomCommandRate(tx, key, fixture.user, fixture.room, 'send'))));
  assert.equal(calls.filter(Boolean).length, 5);
  await first.transactions.write(collectExpiredRates);
  assert.equal(await second.transactions.write(tx => roomCommandRate(tx, key, fixture.user, fixture.room, 'send')), false);
  // Make only the one-second bucket eligible for reset; minute/account budget stays consumed.
  const burstKey = createHmac('sha256', key).update(`send:burst:${fixture.user}:${fixture.room}`).digest();
  await first.transactions.write(tx => tx.execute('UPDATE rate_buckets SET expires_at=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)) WHERE key_digest=?', [burstKey]));
  assert.equal(await second.transactions.write(tx => roomCommandRate(tx, key, fixture.user, fixture.room, 'send')), true);
  const [before] = await first.transactions.read(tx => tx.rows('SELECT COUNT(*) AS total FROM rate_buckets'));
  for (let index = 0; index < 3; index++) await first.transactions.write(tx => roomCommandRate(tx, key, fixture.user, randomUUID(), 'send'));
  const [after] = await first.transactions.read(tx => tx.rows('SELECT COUNT(*) AS total FROM rate_buckets'));
  assert.equal(Number(after.total), Number(before.total));
});
