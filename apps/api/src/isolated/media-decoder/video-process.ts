import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';

export class VideoProcessError extends Error {
  constructor(readonly code: 'VIDEO_PROCESS_FAILED' | 'VIDEO_PROCESS_LIMIT' | 'VIDEO_PROCESS_ABORTED') { super(code); }
}
export interface VideoProcessOptions {
  timeoutMs: number;
  stdoutBytes: number;
  signal?: AbortSignal;
}

/** Internal sandbox primitive, not an API for user commands. Binary and argv come only from
 * fixed decoder code. No shell, inherited credentials, stdin, raw stderr or command-line logs.
 * A killed process must close before rejection so callers cannot remove scratch while it writes.
 */
export function runVideoProcess(binary: string, args: readonly string[], options: VideoProcessOptions): Promise<Buffer> {
  if (!isAbsolute(binary) || binary.includes('\0') || !Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 180_000 ||
      !Number.isSafeInteger(options.stdoutBytes) || options.stdoutBytes < 0 || options.stdoutBytes > 64 * 1024) {
    return Promise.reject(new VideoProcessError('VIDEO_PROCESS_FAILED'));
  }
  if (options.signal?.aborted) return Promise.reject(new VideoProcessError('VIDEO_PROCESS_ABORTED'));
  return new Promise((resolve, reject) => {
    let fault: VideoProcessError | undefined;
    let bytes = 0;
    let stderrBytes = 0;
    const chunks: Buffer[] = [];
    const child = spawn(binary, [...args], {
      shell: false, stdio: ['ignore', 'pipe', 'pipe'],
      env: { LANG: 'C', LC_ALL: 'C' },
    });
    const fail = (code: VideoProcessError['code']): void => {
      fault ??= new VideoProcessError(code);
      child.kill('SIGKILL');
    };
    const abort = (): void => fail('VIDEO_PROCESS_ABORTED');
    const timer = setTimeout(() => fail('VIDEO_PROCESS_LIMIT'), options.timeoutMs);
    options.signal?.addEventListener('abort', abort, { once: true });
    // Abort can arrive between the initial check and listener registration.
    if (options.signal?.aborted) abort();
    child.stdout.on('data', (chunk: Buffer) => {
      if (fault) return;
      bytes += chunk.byteLength;
      if (bytes > options.stdoutBytes) fail('VIDEO_PROCESS_LIMIT');
      else chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > 64 * 1024) fail('VIDEO_PROCESS_LIMIT');
    });
    child.on('error', () => { fault ??= new VideoProcessError('VIDEO_PROCESS_FAILED'); });
    child.once('close', code => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (fault) reject(fault);
      else if (code !== 0) reject(new VideoProcessError('VIDEO_PROCESS_FAILED'));
      else resolve(Buffer.concat(chunks, bytes));
    });
  });
}
