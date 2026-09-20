import { createConnection } from 'node:net';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import type { Readable } from 'node:stream';
import { frame, readFrame, parseDecoderResponse, payloadStream, assertDecoderEnd, decoderDeadlineMs } from '../../../common/media/media-decoder-protocol.js';
import { parseMediaIntent } from '../../../common/media/media-policy.js';
import type { MediaIntent } from '../../../common/media/media-policy.js';
import type { MediaSpooler, SpooledMedia } from '../../../common/media/media-spool.js';
export interface DecodedMedia { kind?: 'IMAGE'; file: SpooledMedia; width: number; height: number; contentType: 'image/webp' }
export interface DecodedVideoMedia {
  kind: 'VIDEO';
  video: { role: 'video'; file: SpooledMedia; contentType: 'video/mp4'; width: number; height: number; durationMs: number };
  poster: { role: 'poster'; file: SpooledMedia; contentType: 'image/webp'; width: number; height: number };
}
export type DecodedResult = (DecodedMedia & { kind: 'IMAGE' }) | DecodedVideoMedia;
export interface ImageDecoder { decode(stream: Readable, intent: MediaIntent, signal: AbortSignal): Promise<DecodedMedia> }
export interface VideoDecoder { decodeVideo(stream: Readable, intent: MediaIntent, signal: AbortSignal): Promise<DecodedVideoMedia> }
export class UnixImageDecoder implements ImageDecoder, VideoDecoder {
  constructor(private readonly socketPath: string, private readonly spool: MediaSpooler) {
    if (!socketPath.startsWith('/') || socketPath.length > 100) throw new Error('invalid_decoder_socket');
  }
  async decode(stream: Readable, intent: MediaIntent, signal: AbortSignal): Promise<DecodedMedia> {
    if (intent.kind === 'VIDEO') { stream.destroy(); throw new Error('decoder_input'); }
    const result = await this.receive(stream, intent, signal);
    if (result.kind !== 'IMAGE') throw new Error('decoder_protocol');
    return result;
  }
  async decodeVideo(stream: Readable, intent: MediaIntent, signal: AbortSignal): Promise<DecodedVideoMedia> {
    if (intent.kind !== 'VIDEO') { stream.destroy(); throw new Error('decoder_input'); }
    const result = await this.receive(stream, intent, signal);
    if (result.kind !== 'VIDEO') throw new Error('decoder_protocol');
    return result;
  }
  private async receive(stream: Readable, intent: MediaIntent, callerSignal: AbortSignal): Promise<DecodedResult> {
    try { intent = parseMediaIntent(intent, { canRegisterStickers: true }); }
    catch (error) { stream.destroy(); throw error; }
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), decoderDeadlineMs(intent.kind === 'VIDEO'));
    const signal = AbortSignal.any([callerSignal, controller.signal]);
    const socket = createConnection({ path: this.socketPath, allowHalfOpen: true });
    socket.on('error', () => {});
    const cancel = () => { socket.destroy(); stream.destroy(); };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    const outputs: SpooledMedia[] = [];
    try {
      await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); socket.once('close', () => reject(new Error('decoder_closed'))); });
      socket.write(frame({ version: 1, intent }));
      const header = readFrame(socket, signal);
      let bytes = 0;
      const bound = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > intent.byteLength) callback(new Error('decoder_input_length')); else callback(null, chunk);
      }, flush(callback) { callback(bytes === intent.byteLength ? undefined : new Error('decoder_input_length')); } });
      // The exact length delimits the upload. Keep the write half open so the
      // server can distinguish cancellation from a client awaiting its response.
      const [value] = await Promise.all([header, pipeline(stream, bound, socket, { signal, end: false })]);
      const metadata = parseDecoderResponse(value, intent);
      for (const variant of metadata.variants) {
        outputs.push(await this.spool.receive(payloadStream(socket, variant.byteLength, signal), {
          id: randomUUID(), maxBytes: variant.byteLength, expectedBytes: variant.byteLength, signal,
        }));
      }
      await assertDecoderEnd(socket, signal);
      if (signal.aborted) throw new Error('decoder_aborted');
      if (metadata.kind === 'IMAGE') {
        const image = metadata.variants[0];
        return { kind: 'IMAGE', file: outputs[0]!, width: image.width, height: image.height, contentType: 'image/webp' };
      }
      const [video, poster] = metadata.variants;
      return { kind: 'VIDEO',
        video: { role: 'video', file: outputs[0]!, contentType: 'video/mp4', width: video.width, height: video.height, durationMs: video.durationMs },
        poster: { role: 'poster', file: outputs[1]!, contentType: 'image/webp', width: poster.width, height: poster.height },
      };
    } catch (error) {
      const cleanup = await Promise.allSettled(outputs.map(output => output.dispose()));
      if (cleanup.some(result => result.status === 'rejected')) throw new Error('decoder_cleanup', { cause: error });
      throw error;
    }
    finally { clearTimeout(deadline); signal.removeEventListener('abort', cancel); socket.destroy(); stream.destroy(); }
  }
}
