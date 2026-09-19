import 'reflect-metadata';
import { readConfig, ConfigurationError } from './config.js';
import { MysqlDatabase } from './database.js';
import { createWorker } from './application.js';
import { LifecycleState } from './health.js';
import { installShutdown } from './lifecycle.js';
import { SafeLogger } from './logging.js';

const logger = new SafeLogger('worker');
try {
  const config = readConfig('worker');
  const database = new MysqlDatabase(config);
  const lifecycle = new LifecycleState();
  const app = await createWorker(database, lifecycle);
  let timer: NodeJS.Timeout | undefined;
  let pending: Promise<void> | undefined;
  let previous: string | undefined;
  const probe = async () => {
    const result = await database.check();
    if (result.reason !== previous) { logger.event('readiness_changed', { reason: result.reason }); previous = result.reason; }
    // Sequential polling; no job claiming until the M05/M07 lease implementation.
    if (!lifecycle.draining) timer = setTimeout(tick, 5000);
  };
  const tick = () => { pending = probe(); };
  installShutdown(lifecycle, logger, async () => {
    clearTimeout(timer);
    await pending;
    try { await app.close(); } finally { await database.close(); }
  });
  tick();
  logger.event('started');
} catch (error) {
  logger.event('startup_failed', { reason: error instanceof ConfigurationError ? 'configuration' : 'dependency' });
  process.exit(1);
}
