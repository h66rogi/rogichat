import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { readRuntimeSettings } from '../config/runtime-settings.js';
import { ConfigurationError } from '../config/config.js';
import { SafeLogger } from '../observability/logging.js';
import { installShutdown } from '../observability/lifecycle.js';
import { LifecycleState } from '../../common/lifecycle/lifecycle-state.js';
import { WorkerModule } from '../../worker.module.js';
export async function bootstrapWorker(): Promise<void> {
  const logger = new SafeLogger('worker');
  try {
    const app = await NestFactory.createApplicationContext(WorkerModule.production(readRuntimeSettings('worker')), { logger: false, abortOnError: false });
    installShutdown(app.get(LifecycleState), logger, () => app.close());
    logger.event('started');
  } catch (error) {
    logger.event('startup_failed', { reason: error instanceof ConfigurationError ? 'configuration' : 'dependency' });
    process.exit(1);
  }
}
