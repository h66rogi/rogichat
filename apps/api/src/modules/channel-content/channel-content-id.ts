import type { Prisma } from '../../generated/prisma/client.js';

/** Every content write runs in a DB transaction; this row serializes Meloming numeric IDs. */
export async function nextChannelContentId(prisma: Prisma.TransactionClient): Promise<number> {
  // Prisma's read-then-create upsert races when the counter row is absent.
  // A single MySQL statement creates or increments it under one row lock.
  await prisma.$executeRaw`INSERT INTO channel_content_counters (\`key\`, \`value\`) VALUES ('global', 1)
    ON DUPLICATE KEY UPDATE \`value\` = \`value\` + 1`;
  const [row] = await prisma.$queryRaw<{ value: bigint }[]>`SELECT \`value\` FROM channel_content_counters WHERE \`key\` = 'global'`;
  const value = Number(row?.value);
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) throw new Error('channel_content_id_exhausted');
  return value;
}
