/* eslint-disable no-console */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

async function main() {
  const p = new PrismaClient();
  try {
    const s = await p.song.count();
    const sn = await p.song.count({ where: { titleSearchable: null } });
    const a = await p.artist.count();
    const an = await p.artist.count({ where: { nameSearchable: null } });
    console.log(`songs total=${s} remaining_null=${sn} done=${s - sn}`);
    console.log(`artists total=${a} remaining_null=${an} done=${a - an}`);
  } finally {
    await p.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
