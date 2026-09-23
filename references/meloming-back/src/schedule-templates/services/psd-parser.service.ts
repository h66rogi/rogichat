import {
  BadRequestException,
  GatewayTimeoutException,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleDestroy,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { existsSync } from 'fs';
import { resolve } from 'path';
import Piscina from 'piscina';
import {
  parseErrorPrefix,
  PsdParseError,
  PsdParseErrorCode,
  PsdParseWorkerInput,
  PsdParseWorkerResult,
} from '../workers/psd-parse.worker';

/**
 * Re-export the worker's result shape so the controller / spec doesn't have
 * to import from `../workers/`.
 */
export type PsdParseResult = PsdParseWorkerResult;

/**
 * Wall-clock cap for a single PSD parse. ag-psd's `readPsd` is synchronous and
 * could in theory loop on a malformed file; pulling the work into a worker
 * thread already isolates the main event loop, but we still abort hung tasks
 * so the response and worker thread don't pile up forever.
 */
const PSD_PARSE_TIMEOUT_MS = 30_000;

/**
 * Piscina pool tuning. Tuned for the real 2 GiB pod budget (not the 8 GiB
 * QA-box assumption the original review used). Under a 300 MB upload the
 * expected peak is:
 *   PSD file buffer (~300 MB) + ag-psd internal buffers + sharp flatten copy
 *   ≈ 1.5 GiB single upload inside a 2 GiB pod (with the 100Mpx cap).
 *
 * Caps:
 *   - 2 worker threads max. Letting two 300 MB parses run concurrently would
 *     already exhaust pod memory, so we cap parallelism to 2 (one active +
 *     one starting up during a burst).
 *   - each worker has a 1 GiB old-gen ceiling — V8 will crash the worker
 *     (not the whole pod) if a single parse tries to grow past that.
 *   - bounded queue at 4 to apply backpressure. Piscina rejects with
 *     `Error('Task queue is at limit')` once the queue fills, and we map
 *     that to HTTP 503 PSD_QUEUE_FULL with a Retry-After hint.
 *   - idleTimeout 60s so we don't pay a worker spawn cost for back-to-back
 *     parses while still releasing memory between bursts.
 */
const POOL_MAX_THREADS = 2;
const POOL_MAX_QUEUE = 4;
const POOL_IDLE_TIMEOUT_MS = 60_000;
const POOL_MAX_OLD_GEN_MB = 1024;

/**
 * Thrown internally when the abort signal fires before the worker resolves.
 * The controller layer turns this into HTTP 504.
 */
export class PsdParseTimeoutError extends Error {
  constructor() {
    super(`PSD parsing exceeded ${PSD_PARSE_TIMEOUT_MS}ms`);
    this.name = 'PsdParseTimeoutError';
  }
}

/**
 * Thrown when piscina rejects a task because its bounded queue is full. We
 * surface this as HTTP 503 Service Unavailable with a Retry-After hint so the
 * caller knows to back off rather than retry immediately.
 *
 * The sentinel we match on is piscina's own `Error('Task queue is at limit')`
 * (see `node_modules/piscina/dist/errors.js#TaskQueueAtLimit`). Matching on
 * the message string is acceptable because piscina exposes no typed class for
 * this case and the message has been stable across the 5.x line.
 */
export class PsdQueueFullError extends Error {
  constructor() {
    super('PSD parse queue is at capacity');
    this.name = 'PsdQueueFullError';
  }
}

/**
 * Thrown on the first `parsePsd` call when the compiled worker file cannot be
 * found on disk. Catching this separately means we fail fast with a clear
 * error rather than letting piscina surface a confusing internal message, and
 * importantly we do NOT crash module init — so a mis-built image still serves
 * every other endpoint while ops investigates.
 *
 * NOTE: this is a *permanent* infrastructure error (the worker artifact is
 * literally missing from the deployed image). Retrying is futile — the next
 * request will hit the same `existsSync` failure. We therefore map it to
 * HTTP 500 (`InternalServerErrorException`) without a `Retry-After` header,
 * not 503: 503 implies "transient, please retry", which is misleading here
 * and would have clients hammering a broken pod.
 */
export class PsdWorkerInitError extends Error {
  constructor(path: string) {
    super(
      `PSD worker file missing at ${path}. Check nest build output (expected dist/schedule-templates/workers/psd-parse.worker.js).`,
    );
    this.name = 'PsdWorkerInitError';
  }
}

/**
 * Piscina's queue-full rejection is a plain Error, not a typed class. This
 * helper detects it via the stable message string so we can translate to 503.
 * See `node_modules/piscina/dist/errors.js#TaskQueueAtLimit`.
 */
function isPiscinaQueueFullError(err: unknown): boolean {
  if (!err) return false;
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message: unknown }).message)
        : '';
  return message === 'Task queue is at limit';
}

/**
 * Resolves to the compiled JS path of the worker file in `dist/`. nest build
 * places the file at `dist/schedule-templates/workers/psd-parse.worker.js`,
 * which is exactly `__dirname/../workers/psd-parse.worker.js` relative to
 * the compiled service file.
 */
function resolveWorkerPath(): string {
  return resolve(__dirname, '..', 'workers', 'psd-parse.worker.js');
}

/**
 * Parses Photoshop documents (PSD) into a TemplateSpecV1 + flatten PNG buffer.
 *
 * The actual parsing happens inside a `piscina` worker thread (see
 * `../workers/psd-parse.worker.ts`) so it never blocks the main Nest event
 * loop. This service is a thin wrapper that owns the pool lifecycle and
 * translates worker errors into NestJS HTTP exceptions.
 *
 * The service is pure with respect to I/O: it takes a buffer and returns
 * parsed data. The caller (controller) is responsible for uploading the
 * original PSD and the flatten PNG to S3.
 */
@Injectable()
export class PsdParserService implements OnModuleDestroy {
  private readonly logger = new Logger(PsdParserService.name);
  private pool: Piscina | null = null;

  /**
   * Lazy pool init so that unit tests of the controller / module don't pay
   * the cost of spinning up worker threads. Tests of this service should
   * mock the pool via `setPoolForTesting`.
   *
   * We also verify the compiled worker file exists before handing piscina a
   * path to it. If nest build didn't produce the worker, we throw
   * `PsdWorkerInitError` here (surfaced by `parsePsd`) rather than at module
   * init, so the rest of the API stays up while ops investigates.
   */
  private getPool(): Piscina {
    if (!this.pool) {
      const workerPath = resolveWorkerPath();
      if (!existsSync(workerPath)) {
        this.logger.error(
          `PSD worker file missing at ${workerPath}. nest build likely did not emit the worker.`,
        );
        throw new PsdWorkerInitError(workerPath);
      }
      this.pool = new Piscina({
        filename: workerPath,
        maxThreads: POOL_MAX_THREADS,
        maxQueue: POOL_MAX_QUEUE,
        idleTimeout: POOL_IDLE_TIMEOUT_MS,
        resourceLimits: {
          maxOldGenerationSizeMb: POOL_MAX_OLD_GEN_MB,
        },
      });
    }
    return this.pool;
  }

  /**
   * Test seam — allows specs to inject a mock pool without touching the real
   * worker file. The mock only needs to implement the methods we use.
   *
   * Blocked in production to prevent accidental misuse (e.g. a loaded test
   * harness or admin script swapping in a stub at runtime). Tests that need
   * the seam either run with the default `NODE_ENV !== 'production'` or must
   * explicitly unset NODE_ENV for that case.
   */
  setPoolForTesting(pool: Piscina | null): void {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('setPoolForTesting is not allowed in production');
    }
    this.pool = pool;
  }

  async parsePsd(buffer: Buffer): Promise<PsdParseResult> {
    // We slice the underlying ArrayBuffer (this allocates a fresh,
    // independently-owned ArrayBuffer — `ArrayBuffer.prototype.slice` is a
    // copy, not a view) and pass it via `transferList`. Piscina then transfers
    // *ownership* of that ArrayBuffer to the worker thread without an
    // additional structured-clone copy.
    //
    // Cost model (honest):
    //   - one extra allocation here on `slice()` (~size of the upload), but
    //   - we avoid the structured-clone duplicate that piscina would otherwise
    //     perform when crossing the worker_threads boundary. Net: one alloc
    //     + one transfer instead of one alloc + one full-size clone.
    //
    // Why we slice instead of transferring `buffer.buffer` directly: Node's
    // `Buffer` instances share an underlying pool-backed ArrayBuffer with
    // other Buffers in the same allocation pool, so transferring the parent
    // buffer would detach unrelated Buffers. The slice is a private copy.
    // After transfer, `ab.byteLength` on this side becomes 0 (ownership
    // moved); the original `buffer` view stays intact because it points to
    // the pool, not to this slice.
    const ab = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    );

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), PSD_PARSE_TIMEOUT_MS);

    const input: PsdParseWorkerInput = { buffer: ab };

    try {
      const pool = this.getPool();
      const result: PsdParseWorkerResult = await pool.run(input, {
        signal: ac.signal,
        transferList: [ab],
      });
      return result;
    } catch (err) {
      throw this.translateWorkerError(err);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Map worker-level errors back into NestJS HTTP exceptions.
   *
   * - `PsdWorkerInitError` (thrown by getPool when the worker file is
   *   missing) → passthrough. This is a service-level typed error, not a
   *   worker-thread rejection, so the controller's toHttpException maps it
   *   to 500.
   * - `PsdParseError` (with one of the documented codes) → BadRequest /
   *   PayloadTooLarge depending on the code.
   * - piscina abort → `PsdParseTimeoutError` (controller maps to 504).
   * - piscina queue-full → `PsdQueueFullError` (controller maps to 503).
   * - anything else → wrapped as `BadRequestException(PSD_INVALID)`.
   *
   * Worker exceptions cross the worker_threads boundary as plain Error
   * objects — properties are preserved but `instanceof PsdParseError` is not.
   * We detect them via the `name === 'PsdParseError'` field.
   */
  private translateWorkerError(err: unknown): Error {
    // PsdWorkerInitError is thrown synchronously from getPool() *before* any
    // worker runs, so it crosses no thread boundary and `instanceof` works.
    // It must be passed through (NOT wrapped as PSD_INVALID) so the
    // controller's toHttpException can map it to 500 PSD_WORKER_INIT_ERROR
    // instead of 400.
    if (err instanceof PsdWorkerInitError) {
      return err;
    }

    // Abort surfaces as either DOMException("AbortError") or Error("The task has been aborted").
    if (this.isAbortError(err)) {
      return new PsdParseTimeoutError();
    }

    // Piscina's bounded-queue rejection. Must be checked BEFORE the generic
    // "unknown worker throw" path, otherwise it would be miscategorized as
    // PSD_INVALID (400) instead of the correct 503.
    if (isPiscinaQueueFullError(err)) {
      this.logger.warn('PSD worker pool queue is at capacity (503)');
      return new PsdQueueFullError();
    }

    const parsed = this.extractParseError(err);
    if (parsed) {
      const { code, message } = parsed;
      this.logger.warn(`PSD worker rejected with ${code}: ${message}`);
      switch (code) {
        case 'PSD_INVALID':
          return new BadRequestException({ code: 'PSD_INVALID', message });
        case 'PSD_OVERSIZED':
          return new PayloadTooLargeException({
            code: 'PSD_OVERSIZED',
            message,
          });
        case 'PSD_UNSUPPORTED_DEPTH':
          return new BadRequestException({
            code: 'PSD_UNSUPPORTED_DEPTH',
            message,
          });
      }
    }

    const message = this.errorMessage(err);
    this.logger.warn(`PSD worker rejected with unknown error: ${message}`);
    return new BadRequestException({
      code: 'PSD_INVALID',
      message: `PSD parse failed: ${message}`,
    });
  }

  private isAbortError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const candidate = err as { name?: unknown; code?: unknown };
    if (candidate.name === 'AbortError') return true;
    if (candidate.code === 'ABORT_ERR') return true;
    // piscina rejects aborted tasks with a DOMException-like error or a
    // plain Error whose message starts with "The task has been aborted".
    const message = this.errorMessage(err);
    if (message === 'The task has been aborted') return true;
    if (message.startsWith('The task has been aborted')) return true;
    return false;
  }

  /**
   * Extract a typed parse error from a worker rejection. We support three
   * paths:
   *   1. In-process throw (specs / before structured clone) — `instanceof
   *      PsdParseError` works.
   *   2. Cross-thread Error — message begins with `[CODE] real message`. We
   *      parse the prefix and strip it.
   *   3. Object with `name === 'PsdParseError' && code` — defensive path for
   *      runtimes that preserve enumerable Error fields (older Node).
   */
  private extractParseError(
    err: unknown,
  ): { code: PsdParseErrorCode; message: string } | null {
    if (err instanceof PsdParseError) {
      return { code: err.code, message: this.stripCodePrefix(err.message) };
    }

    if (err && typeof err === 'object') {
      const candidate = err as {
        name?: unknown;
        code?: unknown;
        message?: unknown;
      };
      if (
        candidate.name === 'PsdParseError' &&
        typeof candidate.code === 'string' &&
        this.isParseErrorCode(candidate.code)
      ) {
        const msg =
          typeof candidate.message === 'string' ? candidate.message : '';
        return { code: candidate.code, message: this.stripCodePrefix(msg) };
      }
    }

    const raw = this.errorMessage(err);
    const fromPrefix = parseErrorPrefix(raw);
    if (fromPrefix) return fromPrefix;
    return null;
  }

  private stripCodePrefix(message: string): string {
    const parsed = parseErrorPrefix(message);
    return parsed ? parsed.message : message;
  }

  private isParseErrorCode(code: string): code is PsdParseErrorCode {
    return (
      code === 'PSD_INVALID' ||
      code === 'PSD_OVERSIZED' ||
      code === 'PSD_UNSUPPORTED_DEPTH'
    );
  }

  private errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }

  /**
   * Translate service-layer typed errors into NestJS HTTP exceptions. Used by
   * the controller; exposed here so the mapping lives next to the rest of the
   * error translation and isn't duplicated.
   *
   * - `PsdParseTimeoutError` → 504 GatewayTimeout (PSD_PARSE_TIMEOUT).
   * - `PsdQueueFullError`    → 503 ServiceUnavailable (PSD_QUEUE_FULL,
   *                            controller adds Retry-After: 5 — this is the
   *                            ONLY path that should set Retry-After).
   * - `PsdWorkerInitError`   → 500 InternalServerError (PSD_WORKER_INIT_ERROR,
   *                            permanent infra error — NO Retry-After).
   * - anything else          → passthrough.
   */
  static toHttpException(err: unknown): Error {
    if (err instanceof PsdParseTimeoutError) {
      return new GatewayTimeoutException({
        code: 'PSD_PARSE_TIMEOUT',
        message: `PSD 파싱이 ${PSD_PARSE_TIMEOUT_MS}ms 내에 완료되지 않았습니다.`,
      });
    }
    if (err instanceof PsdQueueFullError) {
      return new ServiceUnavailableException({
        code: 'PSD_QUEUE_FULL',
        message: '서버가 혼잡합니다. 잠시 후 다시 시도해 주세요.',
      });
    }
    if (err instanceof PsdWorkerInitError) {
      // Permanent infrastructure failure: the compiled worker artifact is
      // missing on disk. Retrying after 5s won't help — the next request
      // will fail the same `existsSync` check. Use 500 so clients treat it
      // as a server-side bug and stop hammering, and explicitly emit no
      // `Retry-After` header.
      return new InternalServerErrorException({
        code: 'PSD_WORKER_INIT_ERROR',
        message: 'PSD 워커 초기화에 실패했습니다.',
      });
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) {
      await this.pool.destroy();
      this.pool = null;
    }
  }
}
