import { createConnection } from 'node:net';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import type { Readable } from 'node:stream';
import { frame, readFrame } from '../../../common/media/media-decoder-protocol.js';
import { assertMediaMetadata, parseMediaIntent } from '../../../common/media/media-policy.js';
import type { MediaIntent } from '../../../common/media/media-policy.js';
import type { MediaSpooler, SpooledMedia } from '../../../common/media/media-spool.js';
export interface DecodedMedia { file: SpooledMedia; width: number; height: number; contentType: 'image/webp' }
export interface ImageDecoder { decode(stream: Readable, intent: MediaIntent, signal: AbortSignal): Promise<DecodedMedia> }
export class UnixImageDecoder implements ImageDecoder {
  constructor(private readonly socketPath: string, private readonly spool: MediaSpooler) {
    if (!socketPath.startsWith('/') || socketPath.length > 100) throw new Error('invalid_decoder_socket');
  }
  async decode(stream: Readable, intent: MediaIntent, signal: AbortSignal): Promise<DecodedMedia> {
    intent = parseMediaIntent(intent, { canRegisterStickers: true });
    if (intent.kind === 'VIDEO' || signal.aborted) { stream.destroy(); throw new Error('decoder_input'); }
    const socket = createConnection({ path: this.socketPath, allowHalfOpen: true });
    socket.on('error', () => {});
    const cancel = () => { socket.destroy(); stream.destroy(); };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    let output: SpooledMedia | undefined;
    try {
      await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); socket.once('close', () => reject(new Error('decoder_closed'))); });
      socket.write(frame(intent));
      const header = readFrame(socket, signal);
      let bytes = 0;
      const bound = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > intent.byteLength) callback(new Error('decoder_input_length')); else callback(null, chunk);
      }, flush(callback) { callback(bytes === intent.byteLength ? undefined : new Error('decoder_input_length')); } });
      // EOF closes only the writing half. The response streams back through the read half.
      const [value] = await Promise.all([header, pipeline(stream, bound, socket, { signal })]);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('decoder_protocol');
      const v = value as Record<string, unknown>;
      if (Object.keys(v).sort().join(',') !== 'byteLength,contentType,height,width' || v.contentType !== 'image/webp' || typeof v.byteLength !== 'number' || !Number.isSafeInteger(v.byteLength) || v.byteLength < 1 || typeof v.width !== 'number' || typeof v.height !== 'number') throw new Error('decoder_protocol');
      assertMediaMetadata(intent, { width: v.width, height: v.height, frames: 1 });
      if (intent.kind === 'AVATAR' && Math.max(v.width, v.height) > 512) throw new Error('decoder_protocol');
      const max = (intent.kind === 'AVATAR' ? 2 : intent.kind === 'STICKER' ? 1 : 10) * 1024 * 1024;
      if (v.byteLength > max) throw new Error('decoder_protocol');
      output = await this.spool.receive(socket, { id: randomUUID(), maxBytes: max, expectedBytes: v.byteLength, signal });
      return { file: output, width: v.width, height: v.height, contentType: 'image/webp' };
    } catch (error) { await output?.dispose(); throw error; }
    finally { signal.removeEventListener('abort', cancel); socket.destroy(); stream.destroy(); }
  }
}
