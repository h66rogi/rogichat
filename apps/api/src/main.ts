import 'reflect-metadata';
import { readConfig, ConfigurationError } from './config.js';
import { MysqlDatabase } from './database.js';
import { createApi } from './application.js';
import { LifecycleState } from './health.js';
import { installShutdown } from './lifecycle.js';
import { SafeLogger } from './logging.js';
import { readAuthConfig } from './auth-config.js';
import { Sessions } from './auth-core.js';
import { AuthFlow } from './auth-flow.js';
import { HttpBroker } from './broker.js';

const logger = new SafeLogger('api');
try {
  const config = readConfig('api');
  const database = new MysqlDatabase(config);
  const lifecycle = new LifecycleState();
  const authConfig = config.environment === 'qa' || config.environment === 'production' || process.env.AUTH_SECRET_FILE ? readAuthConfig(config) : undefined;
  const sessions = authConfig ? new Sessions(database.transactions, authConfig.audience, authConfig.key) : undefined;
  const auth = authConfig && sessions ? { config: authConfig, sessions, flow: new AuthFlow(sessions, authConfig, new HttpBroker(authConfig)) } : undefined;
  const app = await createApi(database, logger, lifecycle, auth);
  installShutdown(lifecycle, logger, async () => { try { await app.close(); } finally { await database.close(); } });
  await app.listen(config.port, config.host);
  logger.event('started');
} catch (error) {
  logger.event('startup_failed', { reason: error instanceof ConfigurationError ? 'configuration' : 'dependency' });
  process.exit(1);
}
