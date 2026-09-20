import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import { constants } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { chmod, mkdtemp, rm, open } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { MediaSpooler } from '../../common/media/media-spool.js';
import { frame, readFrame, parseDecoderRequest, parseDecoderResponse, decoderDeadlineMs, payloadStream, assertDecoderEnd } from '../../common/media/media-decoder-protocol.js';
import type { VideoBinaries } from './video-decoder.js';
import { runDecoderChild } from './decoder-child.js';

export function decoderServer(directory: string, binaries: VideoBinaries = { ffmpeg: '/usr/bin/ffmpeg', ffprobe: '/usr/bin/ffprobe' }) {
  // Deployment must enforce a hard tmpfs quota; application bounds alone are not isolation.
  const spool = new MediaSpooler({ directory, capacityBytes: 128 * 1024 * 1024, maxConcurrent: 1 });
  let busy = false; let stopping = false;
  const sockets = new Set<Socket>(); const jobs = new Set<Promise<void>>();
  const server = createServer({ allowHalfOpen: true }, (socket: Socket) => {
    socket.on('error', () => {});
    if (busy || stopping) { socket.destroy(); return; }
    busy = true; sockets.add(socket);
    const job = (async () => {
      const controller = new AbortController();
      let timeout = setTimeout(() => controller.abort(), 30_000);
      const abort = () => { controller.abort(); socket.destroy(); }; socket.once('close', abort);
      controller.signal.addEventListener('abort', abort, { once: true });
      let input: Awaited<ReturnType<MediaSpooler['receive']>> | undefined;
      let outputDirectory: string | undefined;
      const outputs: { file: FileHandle; bytes: number }[] = [];
      try {
        const intent = parseDecoderRequest(await readFrame(socket, controller.signal));
        clearTimeout(timeout); timeout = setTimeout(abort, decoderDeadlineMs(intent.kind === 'VIDEO'));
        input = await spool.receive(payloadStream(socket, intent.byteLength, controller.signal), { id: randomUUID(), maxBytes: intent.byteLength, expectedBytes: intent.byteLength, signal: controller.signal });
        // Keep the request half open during conversion: EOF means cancellation,
        // and any extra byte is a protocol violation. Half-closing the upload
        // would hide a later peer disconnect until our first response write.
        void assertDecoderEnd(socket, controller.signal).then(abort, abort);
        outputDirectory = await mkdtemp(join(directory, 'output-')); await chmod(outputDirectory, 0o700);
        const metadata = parseDecoderResponse(await runDecoderChild([
          fileURLToPath(new URL('./media-decode-once.js', import.meta.url)), input.path, outputDirectory, JSON.stringify(intent), binaries.ffmpeg, binaries.ffprobe,
        ], controller.signal, intent.kind === 'VIDEO' ? 210_000 : 60_000), intent);
        const files = metadata.variants.map(variant => join(outputDirectory!, variant.role === 'image' ? 'image.webp' : variant.role === 'video' ? 'video/video.mp4' : 'video/poster.webp'));
        for (const [index, path] of files.entries()) {
          const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
          outputs.push({ file, bytes: metadata.variants[index]!.byteLength });
          const info = await file.stat();
          if (!info.isFile() || info.size !== metadata.variants[index]!.byteLength) throw new Error('decoder_output');
        }
        await pipeline(Readable.from((async function* () {
          yield frame(metadata);
          for (const output of outputs) {
            const source = output.file.createReadStream({ highWaterMark: 64 * 1024, autoClose: false });
            let bytes = 0;
            try {
              for await (const chunk of source) {
                bytes += (chunk as Buffer).length;
                if (bytes > output.bytes) throw new Error('decoder_output');
                yield chunk;
              }
              if (bytes !== output.bytes) throw new Error('decoder_output');
            } finally { source.destroy(); }
          }
        })(), { objectMode: false }), socket, { signal: controller.signal });
      } catch { socket.destroy(); }
      finally {
        controller.abort();
        clearTimeout(timeout); socket.off('close', abort); controller.signal.removeEventListener('abort', abort);
        await Promise.allSettled(outputs.map(output => output.file.close()));
        try { await input?.dispose(); }
        finally {
          try { if (outputDirectory) await rm(outputDirectory, { recursive: true, force: true }); }
          finally { sockets.delete(socket); busy = false; }
        }
      }
    })().catch(() => { socket.destroy(); });
    jobs.add(job); void job.finally(() => jobs.delete(job));
  });
  // net.Server.close alone waits for connected clients forever. Shutdown actively
  // cancels each job and its process group, then waits for exit and scratch disposal.
  const close = server.close;
  server.close = (callback?: (error?: Error) => void) => {
    stopping = true;
    for (const socket of sockets) socket.destroy();
    close.call(server, error => { void Promise.allSettled([...jobs]).then(() => callback?.(error)); });
    return server;
  };
  server.maxConnections = 2;
  return server;
}
