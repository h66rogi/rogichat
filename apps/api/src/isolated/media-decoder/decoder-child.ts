import { spawn } from 'node:child_process';

/** Trusted argv only. Every native descendant inherits this per-job POSIX group.
 * Kill on exit as well: a crashed/exited Node leader may leave stdout open in a child.
 * Never signal a caller-supplied PID or process group zero. Await child close before cleanup.
 */
export function runDecoderChild(args: readonly string[], signal: AbortSignal, timeoutMs: number): Promise<unknown> {
  if (!['linux', 'darwin'].includes(process.platform) || signal.aborted) return Promise.reject(new Error('decode_failed'));
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [...args], {
      detached: true, env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, stdio: ['ignore', 'pipe', 'ignore'],
    });
    const group = proc.pid;
    let data = Buffer.alloc(0); let invalid = false; let killed = false;
    const killGroup = () => {
      if (killed) return;
      killed = true;
      if (group !== undefined && Number.isSafeInteger(group) && group > 0) {
        try { process.kill(-group, 'SIGKILL'); }
        catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH')) invalid = true; }
      } else invalid = true;
    };
    const abort = () => { invalid = true; killGroup(); };
    const deadline = setTimeout(abort, timeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    proc.stdout.on('data', (chunk: Buffer) => { if (data.length + chunk.length > 1024) abort(); else data = Buffer.concat([data, chunk]); });
    proc.stdout.once('error', abort);
    proc.stdout.once('close', () => { if (!proc.stdout.readableEnded) abort(); });
    proc.once('error', abort);
    // 'exit' precedes 'close' even when a grandchild inherited the stdout pipe.
    proc.once('exit', killGroup);
    proc.once('close', code => {
      clearTimeout(deadline); signal.removeEventListener('abort', abort);
      if (invalid || code !== 0 || signal.aborted) { reject(new Error('decode_failed')); return; }
      try { resolve(JSON.parse(data.toString('utf8')) as unknown); } catch { reject(new Error('decode_failed')); }
    });
  });
}
