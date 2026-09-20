import type { RowDataPacket } from 'mysql2';
import type { Transaction } from '../database/transactions.js';
export async function consumeRate(tx: Transaction, key: Buffer, limit: number, seconds: number): Promise<boolean> {
  if (key.length !== 32 || !Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(seconds) || seconds < 1 || seconds > 86400) throw new Error('invalid_rate_policy');
  // A duplicate no-op UPDATE acquires X directly; INSERT IGNORE takes S then
  // deadlocks on concurrent upgrade to the admission lock (real ten-caller test).
  const key_digest = new Uint8Array(key);
  await tx.execute('INSERT INTO rate_buckets (key_digest,used,expires_at) VALUES (?,0,TIMESTAMPADD(SECOND,?,UTC_TIMESTAMP(3))) ON DUPLICATE KEY UPDATE key_digest=key_digest', [key, seconds]);
  const [bucket] = await tx.rows<RowDataPacket>('SELECT used,expires_at<=UTC_TIMESTAMP(3) AS expired FROM rate_buckets WHERE key_digest=? FOR UPDATE', [key]);
  if (!bucket) throw new Error('rate_bucket_missing');
  if (Number(bucket.expired) === 1) await tx.prisma.rate_buckets.updateMany({ where: { key_digest }, data: { used: 0, expires_at: new Date((await tx.now()).getTime() + seconds * 1000) } });
  else if (Number(bucket.used) >= limit) return false;
  await tx.prisma.rate_buckets.updateMany({ where: { key_digest }, data: { used: { increment: 1 } } });
  return true;
}

export async function collectExpiredRates(tx: Transaction): Promise<number> {
  const rows = await tx.rows<{ key_digest: Buffer }>('SELECT key_digest FROM rate_buckets WHERE expires_at < TIMESTAMPADD(SECOND,-60,UTC_TIMESTAMP(3)) ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED');
  return (await tx.prisma.rate_buckets.deleteMany({ where: { key_digest: { in: rows.map(row => new Uint8Array(row.key_digest)) } } })).count;
}
