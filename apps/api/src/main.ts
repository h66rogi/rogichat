import 'reflect-metadata';
import { readConfig, ConfigurationError } from './config.js';
import { MysqlDatabase } from './database.js';
import { createApi } from './application.js';
import { LifecycleState } from './health.js';
import { installShutdown } from './lifecycle.js';
import { SafeLogger } from './logging.js';

const logger = new SafeLogger('api');
try {
  const config = readConfig('api');
  const database = new MysqlDatabase(config);
  const lifecycle = new LifecycleState();
  const app = await createApi(database, logger, lifecycle);
  installShutdown(lifecycle, logger, async () => { try { await app.close(); } finally { await database.close(); } });
  await app.listen(config.port, config.host);
  logger.event('started');
} catch (error) {
  logger.event('startup_failed', { reason: error instanceof ConfigurationError ? 'configuration' : 'dependency' });
  process.exit(1);
}
