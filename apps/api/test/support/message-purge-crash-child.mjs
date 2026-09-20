import 'reflect-metadata';
import { performance } from 'node:perf_hooks';
import { NestFactory } from '@nestjs/core';
import { PrismaDatabase } from '../../dist/infrastructure/database/database.js';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { MessagePurgeModule } from '../../dist/modules/deletion/message-purge.module.js';
import { MessagePurgeService } from '../../dist/modules/deletion/message-purge.service.js';
import { requirePurgeCrashDatabase } from './message-purge-crash-process.mjs';

const send = frame => new Promise((resolve, reject) => process.send(frame, error => error ? reject(new Error('fixture_ipc_failed')) : resolve()));
const watchdog = setTimeout(() => process.exit(1), 12000);
process.on('disconnect', () => process.exit(1));
async function run(input) {
  requirePurgeCrashDatabase();
  if (!input || !['pre-commit', 'post-commit', 'recover'].includes(input.mode) || JSON.stringify(input).length > 2048) throw new Error('invalid_fixture_input');
  const lease = { ...input.lease, generation: BigInt(input.lease.generation) };
  const database = new PrismaDatabase(readConfig('api'));
  const context = await NestFactory.createApplicationContext(MessagePurgeModule, { logger: false, abortOnError: false });
  try {
    const service = context.get(MessagePurgeService);
    const transactions = input.mode === 'pre-commit' ? {
      write: operation => {
        const started = performance.now();
        return database.transactions.write(async tx => {
          const result = await operation(tx);
          if (result.status !== 'rows_purged' || result.changed !== 1) throw new Error('fixture_final_page_required');
          const elapsedMs = performance.now() - started;
          // Leave at least five seconds of the real eight-second TX budget.
          // Slow setup fails, rather than relabeling a timeout as process death.
          if (elapsedMs >= 3000) throw new Error('fixture_precommit_budget_exceeded');
          await send({ type: 'pre-commit', elapsedMs, at: Date.now() });
          // Production callback completed all writes/fencing but has NOT returned
          // to Transactions.write, so the driver has not been asked to COMMIT.
          await new Promise(() => {});
          return result;
        });
      },
    } : database.transactions;
    const result = await service.step(transactions, 'qa', lease, 1);
    if (input.mode === 'post-commit') {
      if (result.status !== 'rows_purged' || result.changed !== 1) throw new Error('fixture_final_page_required');
      // Transactions.write resolved successfully. Lose the caller result here;
      // this is intentionally NOT a lost driver COMMIT acknowledgment.
      await send({ type: 'post-commit' });
      await new Promise(() => {});
    }
    await send({ type: 'result', result });
  } finally { await context.close(); await database.close(); }
}

try {
  requirePurgeCrashDatabase();
  if (!process.send) throw new Error('fixture_ipc_required');
  process.once('message', input => {
    void run(input).then(() => { clearTimeout(watchdog); process.exit(0); }, async () => {
      // Never serialize a provider/database exception, URL, lease or fixture body.
      try { await send({ type: 'failed' }); } finally { process.exit(1); }
    });
  });
  await send({ type: 'ready' });
} catch { process.exit(1); }
