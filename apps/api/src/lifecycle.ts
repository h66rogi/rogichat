import type { SafeLogger } from './logging.js';
import type { LifecycleState } from './health.js';

export function installShutdown(lifecycle: LifecycleState, logger: SafeLogger, close: () => Promise<void>): void {
  let stopping = false;
  const stop = (failed: boolean) => {
    if (stopping) return;
    stopping = true;
    lifecycle.draining = true;
    logger.event(failed ? 'process_fault' : 'shutdown_started');
    const deadline = setTimeout(() => { logger.event('shutdown_timeout'); process.exit(1); }, 10000);
    void close().then(() => {
      clearTimeout(deadline);
      logger.event('shutdown_complete');
      process.exitCode = failed ? 1 : 0;
    }).catch(() => {
      clearTimeout(deadline);
      logger.event('shutdown_failed');
      process.exit(1);
    });
  };
  process.once('SIGTERM', () => { stop(false); });
  process.once('SIGINT', () => { stop(false); });
  // Never let Node's default handlers print unredacted errors or rejection values.
  process.once('uncaughtException', () => { stop(true); });
  process.once('unhandledRejection', () => { stop(true); });
}
