import 'reflect-metadata';
import { readRuntimeSettings } from '../config/runtime-settings.js';
import { ConfigurationError } from '../config/config.js';
import { SafeLogger } from '../observability/logging.js';
import { installShutdown } from '../observability/lifecycle.js';
import { LifecycleState } from '../../common/lifecycle/lifecycle-state.js';
import { createConfiguredApi } from '../../application.js';
import { AppModule } from '../../app.module.js';
export async function bootstrapApi(): Promise<void> {
  const logger = new SafeLogger('api');
  try {
    const settings = readRuntimeSettings('api');
    const app = await createConfiguredApi(AppModule.production(settings), logger, undefined, settings.auth, Boolean(settings.media), settings.config.environment);
    installShutdown(app.get(LifecycleState), logger, () => app.close());
    await app.listen(settings.config.port, settings.config.host);
    logger.event('started');
  } catch (error) {
    logger.event('startup_failed', { reason: error instanceof ConfigurationError ? 'configuration' : 'dependency' });
    process.exit(1);
  }
}
