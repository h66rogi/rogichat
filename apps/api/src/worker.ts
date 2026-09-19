import 'reflect-metadata';
import { readConfig, ConfigurationError } from './config.js';
import { MysqlDatabase } from './database.js';
import { createWorker } from './application.js';
import { LifecycleState } from './health.js';
import { installShutdown } from './lifecycle.js';
import { SafeLogger } from './logging.js';
import { WorkerLoop } from './worker-loop.js';
import { publishText } from './publications.js';
import { collectExpiredRates } from './repositories.js';

const logger = new SafeLogger('worker');
try {
  const config = readConfig('worker');
  const database = new MysqlDatabase(config);
  const lifecycle = new LifecycleState();
  const app = await createWorker(database, lifecycle);
  const jobs = new WorkerLoop(database.transactions, lifecycle, { PUBLICATION: lease => publishText(database.transactions, lease) }, { ready: async () => (await database.check()).ready });
  let timer: NodeJS.Timeout | undefined;
  let pending: Promise<void> | undefined;
  let previous: string | undefined;
  const probe = async () => {
    const result = await database.check();
    if (result.reason !== previous) { logger.event('readiness_changed', { reason: result.reason }); previous = result.reason; }
    if (result.ready) await database.transactions.write(collectExpiredRates).catch(() => {});
    if (!lifecycle.draining) timer = setTimeout(tick, 5000);
  };
  const tick = () => { pending = probe(); };
  installShutdown(lifecycle, logger, async () => {
    clearTimeout(timer);
    await jobs.stop();
    await pending;
    try { await app.close(); } finally { await database.close(); }
  });
  tick();
  jobs.start();
  logger.event('started');
} catch (error) {
  logger.event('startup_failed', { reason: error instanceof ConfigurationError ? 'configuration' : 'dependency' });
  process.exit(1);
}
