import { createHash } from 'node:crypto';
import { chmod, mkdtemp, open, rm } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const CAPACITY = 256 * 1024 * 1024;
const FILE_LIMIT = 50 * 1024 * 1024;
const CONCURRENCY = 2;
// Process-wide ceilings survive accidentally constructing a second spooler.
let globalReserved = 0;
let globalActive = 0;

export type SpoolCode = 'INVALID_INPUT' | 'CAPACITY_EXCEEDED' | 'CONCURRENCY_EXCEEDED' |
  'TOO_LARGE' | 'LENGTH_MISMATCH' | 'EMPTY_UPLOAD' | 'ABORTED' | 'IDLE_TIMEOUT' |
  'TOTAL_TIMEOUT' | 'IO_FAILED' | 'CLEANUP_FAILED';
export class MediaSpoolError extends Error {
  constructor(readonly code: SpoolCode) { super(code); }
}
export interface MediaSpoolOptions {
  /** Trusted host configuration only; never a request path. */
  directory?: string;
  capacityBytes?: number;
  maxConcurrent?: number;
  idleMs?: number;
  totalMs?: number;
}
export interface ReceiveMediaOptions {
  /** Internally allocated UUID, not the client's filename or object key. */
  id: string;
  maxBytes: number;
  expectedBytes?: number;
  signal?: AbortSignal;
}
export interface SpooledMedia {
  /** Internal path, never an HTTP response field. Valid only until dispose. */
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  dispose(): Promise<void>;
}
function bounded(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new MediaSpoolError('INVALID_INPUT');
  return value;
}

// This utility does not authenticate, decode, parse multipart, sign URLs or contact storage.
// A private, size-limited host scratch mount and crash-orphan cleanup remain deployment gates.
export class MediaSpooler {
  private readonly directory: string;
  private readonly capacity: number;
  private readonly concurrency: number;
  private readonly idleMs: number;
  private readonly totalMs: number;
  private reserved = 0;
  private active = 0;
  constructor(options: MediaSpoolOptions = {}) {
    this.directory = options.directory ?? tmpdir();
    if (!isAbsolute(this.directory)) throw new MediaSpoolError('INVALID_INPUT');
    this.capacity = bounded(options.capacityBytes ?? CAPACITY, CAPACITY);
    this.concurrency = bounded(options.maxConcurrent ?? CONCURRENCY, CONCURRENCY);
    this.idleMs = bounded(options.idleMs ?? 30000, 30000);
    this.totalMs = bounded(options.totalMs ?? 300000, 300000);
  }
  stats(): { activeUploads: number; reservedBytes: number } {
    return { activeUploads: this.active, reservedBytes: this.reserved };
  }
  async receive(source: Readable, options: ReceiveMediaOptions): Promise<SpooledMedia> {
    if (!(source instanceof Readable) || source.readableObjectMode || source.readableEncoding !== null ||
        typeof options.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(options.id)) throw new MediaSpoolError('INVALID_INPUT');
    const maximum = bounded(options.maxBytes, FILE_LIMIT);
    const expected = options.expectedBytes === undefined ? undefined : bounded(options.expectedBytes, maximum);
    const reservation = expected ?? maximum;
    if (options.signal?.aborted) throw new MediaSpoolError('ABORTED');
    if (this.active >= this.concurrency || globalActive >= CONCURRENCY) throw new MediaSpoolError('CONCURRENCY_EXCEEDED');
    if (reservation > this.capacity - this.reserved || reservation > CAPACITY - globalReserved) throw new MediaSpoolError('CAPACITY_EXCEEDED');
    // Synchronous reservation before the first await; no race between callers.
    this.active++; globalActive++; this.reserved += reservation; globalReserved += reservation;
    let directory: string | undefined;
    let file: FileHandle | undefined;
    let released = false;
    let cleanup: Promise<void> | undefined;
    const dispose = (): Promise<void> => {
      cleanup ??= (async () => {
        try {
          await file?.close(); file = undefined;
          if (directory) await rm(directory, { recursive: true, force: true });
          if (!released) { released = true; this.reserved -= reservation; globalReserved -= reservation; }
        } catch { throw new MediaSpoolError('CLEANUP_FAILED'); }
      })();
      // A failed cleanup conservatively retains its reservation. A later dispose can retry.
      const attempt = cleanup;
      return attempt.catch(error => { if (cleanup === attempt) cleanup = undefined; throw error; });
    };
    const controller = new AbortController();
    let failure: MediaSpoolError | undefined;
    const stop = (code: SpoolCode) => { failure ??= new MediaSpoolError(code); controller.abort(); };
    const abort = () => stop('ABORTED');
    const inputError = (error: Error) => stop(error instanceof MediaSpoolError ? error.code : 'IO_FAILED');
    options.signal?.addEventListener('abort', abort, { once: true });
    source.once('error', inputError);
    let idle: ReturnType<typeof setTimeout> | undefined;
    const refreshIdle = () => { if (idle) clearTimeout(idle); idle = setTimeout(() => stop('IDLE_TIMEOUT'), this.idleMs); };
    const total = setTimeout(() => stop('TOTAL_TIMEOUT'), this.totalMs);
    refreshIdle();
    let bytes = 0;
    const hash = createHash('sha256');
    try {
      directory = await mkdtemp(join(this.directory, 'rogichat-upload-'));
      await chmod(directory, 0o700);
      if (failure) throw failure;
      const path = join(directory, options.id + '.upload');
      file = await open(path, 'wx', 0o600);
      if (failure) throw failure;
      const limit = new Transform({ highWaterMark: 64 * 1024,
        transform(chunk: Buffer, _encoding, done) {
          if (!Buffer.isBuffer(chunk)) { done(new MediaSpoolError('INVALID_INPUT')); return; }
          // Never write even the first byte of an overflowing chunk.
          if (chunk.length > maximum - bytes) { done(new MediaSpoolError('TOO_LARGE')); return; }
          if (expected !== undefined && chunk.length > expected - bytes) { done(new MediaSpoolError('LENGTH_MISMATCH')); return; }
          bytes += chunk.length; hash.update(chunk); refreshIdle(); done(null, chunk);
        },
      });
      await pipeline(source, limit, file.createWriteStream({ autoClose: true, highWaterMark: 64 * 1024 }), { signal: controller.signal });
      if (failure) throw failure;
      if (bytes === 0) throw new MediaSpoolError('EMPTY_UPLOAD');
      if (expected !== undefined && bytes !== expected) throw new MediaSpoolError('LENGTH_MISMATCH');
      return Object.freeze({ path, bytes, sha256: hash.digest('hex'), dispose });
    } catch (error) {
      // Never propagate filesystem paths, request errors or AbortSignal reasons to HTTP/logs.
      source.destroy();
      await dispose();
      throw failure ?? (error instanceof MediaSpoolError ? error : new MediaSpoolError('IO_FAILED'));
    } finally {
      clearTimeout(total); if (idle) clearTimeout(idle);
      options.signal?.removeEventListener('abort', abort);
      source.removeListener('error', inputError);
      this.active--; globalActive--;
    }
  }
}
