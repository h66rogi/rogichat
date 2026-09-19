import type { SafeLogger } from './logging.js';
import type { LifecycleState } from './health.js';

export function installShutdown(lifecycle: LifecycleState, logger: SafeLogger, close: () => Promise<void>): void {
  let stopping = false;
  let hasFailed = false;
  const stop = (failed: boolean) => {
    // A fault during an already-running graceful drain must still make exit unsuccessful.
    if (failed) {
      hasFailed = true;
      process.exitCode = 1;
      logger.event('process_fault');
    }
    if (stopping) return;
    stopping = true;
    lifecycle.draining = true;
    if (!failed) logger.event('shutdown_started');
    const deadline = setTimeout(() => { logger.event('shutdown_timeout'); process.exit(1); }, 10000);
    void Promise.resolve().then(close).then(() => {
      logger.event('shutdown_complete');
      process.exitCode = hasFailed ? 1 : 0;
      // Do not keep a clean process alive, but retain the bound for leaked handles.
      deadline.unref();
    }).catch(() => {
      clearTimeout(deadline);
      logger.event('shutdown_failed');
      process.exit(1);
    });
  };
  process.once('SIGTERM', () => { stop(false); });
  process.once('SIGINT', () => { stop(false); });
  // Never let Node's default handlers print unredacted errors or rejection values.
  // Keep both handlers installed throughout drain; a second fault must not reach
  // Node's default handler and expose its unredacted error/rejection value.
  process.on('uncaughtException', () => { stop(true); });
  process.on('unhandledRejection', () => { stop(true); });
}
