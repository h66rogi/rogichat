import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import { createReadStream } from 'node:fs';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { MediaSpooler } from '../../common/media/media-spool.js';
import { parseMediaIntent } from '../../common/media/media-policy.js';
import { frame, readFrame } from '../../common/media/media-decoder-protocol.js';

async function child(input: string, output: string, intent: unknown, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // Credential-free environment is defense in depth. The actual boundary is the container:
    // no network, secrets, host filesystem or Docker socket; private bounded /tmp only.
    const proc = spawn(process.execPath, [fileURLToPath(new URL('./media-decode-once.js', import.meta.url)), input, output, JSON.stringify(intent)],
      { env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, stdio: ['ignore', 'pipe', 'ignore'] });
    let data = Buffer.alloc(0); let invalid = false;
    const abort = () => { invalid = true; proc.kill('SIGKILL'); };
    const deadline = setTimeout(abort, 60000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    proc.stdout.on('data', (chunk: Buffer) => { if (data.length + chunk.length > 1024) abort(); else data = Buffer.concat([data, chunk]); });
    proc.once('error', () => { invalid = true; });
    proc.once('close', code => {
      clearTimeout(deadline); signal.removeEventListener('abort', abort);
      if (invalid || code !== 0) { reject(new Error('decode_failed')); return; }
      try { resolve(JSON.parse(data.toString('utf8')) as unknown); } catch { reject(new Error('decode_failed')); }
    });
  });
}
export function decoderServer(directory: string) {
  // The dedicated container also needs a 128 MiB tmpfs quota covering both input and output.
  const spool = new MediaSpooler({ directory, capacityBytes: 128 * 1024 * 1024, maxConcurrent: 1 });
  let busy = false;
  const server = createServer({ allowHalfOpen: true }, (socket: Socket) => {
    socket.on('error', () => {});
    if (busy) { socket.destroy(); return; }
    busy = true;
    void (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000);
      const abort = () => controller.abort(); socket.once('close', abort);
      let input: Awaited<ReturnType<MediaSpooler['receive']>> | undefined;
      let outputDirectory: string | undefined;
      try {
        const intent = parseMediaIntent(await readFrame(socket, controller.signal), { canRegisterStickers: true });
        if (intent.kind === 'VIDEO') throw new Error('unsupported_decoder');
        input = await spool.receive(socket, { id: randomUUID(), maxBytes: intent.byteLength, expectedBytes: intent.byteLength, signal: controller.signal });
        outputDirectory = await mkdtemp(join(directory, 'output-')); await chmod(outputDirectory, 0o700);
        const output = join(outputDirectory, 'image.webp');
        const metadata = await child(input.path, output, intent, controller.signal);
        socket.write(frame(metadata));
        await pipeline(createReadStream(output, { highWaterMark: 64 * 1024 }), socket, { signal: controller.signal });
      } catch { socket.destroy(); }
      finally {
        clearTimeout(timeout); socket.off('close', abort);
        try { await input?.dispose(); if (outputDirectory) await rm(outputDirectory, { recursive: true, force: true }); }
        finally { busy = false; }
      }
    })().catch(() => { socket.destroy(); });
  });
  server.maxConnections = 2;
  return server;
}
