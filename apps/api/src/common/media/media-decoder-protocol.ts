import type { Socket } from 'node:net';

// A tiny bounded framed header, followed by an EOF-terminated bounded binary stream.
// The Unix socket crosses the container boundary; no credential or filesystem path is serialized.
export function frame(value: unknown): Buffer {
  const data = Buffer.from(JSON.stringify(value));
  if (data.length > 1024) throw new Error('decoder_protocol');
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  return Buffer.concat([size, data]);
}
export function readFrame(socket: Socket, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let header = Buffer.alloc(0);
    const cleanup = () => { socket.off('data', data); socket.off('end', fail); socket.off('close', fail); socket.off('error', fail); signal.removeEventListener('abort', fail); };
    const fail = () => { cleanup(); reject(new Error('decoder_protocol')); };
    const data = (chunk: Buffer) => {
      // The first chunk may also contain binary bytes: retain at most the 1,028-byte header.
      let offset = 0;
      while (offset < chunk.length) {
        const wanted = header.length < 4 ? 4 : 4 + header.readUInt32BE(0);
        const count = Math.min(wanted - header.length, chunk.length - offset);
        header = Buffer.concat([header, chunk.subarray(offset, offset + count)]); offset += count;
        if (header.length >= 4) {
          const length = header.readUInt32BE(0);
          if (length < 2 || length > 1024) { fail(); socket.destroy(); return; }
          if (header.length === length + 4) {
            socket.pause(); cleanup();
            if (offset < chunk.length) socket.unshift(chunk.subarray(offset));
            try { resolve(JSON.parse(header.subarray(4).toString('utf8')) as unknown); }
            catch { reject(new Error('decoder_protocol')); }
            return;
          }
        }
      }
    };
    if (signal.aborted || socket.destroyed || socket.readableEnded) { fail(); return; }
    signal.addEventListener('abort', fail, { once: true });
    socket.on('data', data); socket.once('end', fail); socket.once('close', fail); socket.once('error', fail);
    socket.resume();
  });
}
