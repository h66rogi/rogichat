import type { Socket } from 'node:net';
import { Readable } from 'node:stream';
import { assertMediaMetadata, parseMediaIntent } from './media-policy.js';
import type { MediaIntent } from './media-policy.js';

// A bounded canonical JSON header precedes exact-length binary payloads.
// Requests stay open for cancellation; only responses end with EOF.
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
            try {
              const original = header.subarray(4);
              const encoded = new TextDecoder('utf-8', { fatal: true }).decode(original);
              const value: unknown = JSON.parse(encoded);
              // Compare original bytes: UTF-8 decoding strips a leading BOM.
              // Canonical JSON forbids duplicate keys and ambiguous encodings.
              if (!original.equals(Buffer.from(JSON.stringify(value), 'utf-8'))) throw new Error('decoder_protocol');
              resolve(value);
            }
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

export const DECODER_PROTOCOL_VERSION = 1;
export const decoderDeadlineMs = (video: boolean): number => video ? 270_000 : 120_000;
export interface ImageVariant { role: 'image'; contentType: 'image/webp'; byteLength: number; width: number; height: number }
export interface VideoVariant { role: 'video'; contentType: 'video/mp4'; byteLength: number; width: number; height: number; durationMs: number }
export interface PosterVariant { role: 'poster'; contentType: 'image/webp'; byteLength: number; width: number; height: number }
export type DecoderResponse =
  | { version: 1; kind: 'IMAGE'; variants: [ImageVariant] }
  | { version: 1; kind: 'VIDEO'; variants: [VideoVariant, PosterVariant] };

function exact(value: unknown, keys: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys) throw new Error('decoder_protocol');
}
export function parseDecoderRequest(value: unknown): Readonly<MediaIntent> {
  exact(value, 'intent,version');
  if (value.version !== DECODER_PROTOCOL_VERSION) throw new Error('decoder_protocol');
  return parseMediaIntent(value.intent, { canRegisterStickers: true });
}
export function parseDecoderResponse(value: unknown, intent: MediaIntent): DecoderResponse {
  exact(value, 'kind,variants,version');
  const video = intent.kind === 'VIDEO';
  if (value.version !== 1 || value.kind !== (video ? 'VIDEO' : 'IMAGE') || !Array.isArray(value.variants) || value.variants.length !== (video ? 2 : 1)) throw new Error('decoder_protocol');
  for (const [index, variant] of value.variants.entries()) {
    const rendition = video && index === 0;
    exact(variant, rendition ? 'byteLength,contentType,durationMs,height,role,width' : 'byteLength,contentType,height,role,width');
    const cap = video ? (rendition ? 50 : 2) : intent.kind === 'AVATAR' ? 2 : intent.kind === 'STICKER' ? 1 : 10;
    if (variant.role !== (video ? (rendition ? 'video' : 'poster') : 'image') || variant.contentType !== (rendition ? 'video/mp4' : 'image/webp') ||
        typeof variant.byteLength !== 'number' || !Number.isSafeInteger(variant.byteLength) || variant.byteLength < 1 || variant.byteLength > cap * 1024 * 1024 ||
        typeof variant.width !== 'number' || typeof variant.height !== 'number') throw new Error('decoder_protocol');
    if (rendition) {
      if (typeof variant.durationMs !== 'number' || variant.width % 2 || variant.height % 2) throw new Error('decoder_protocol');
      assertMediaMetadata(intent, { width: variant.width, height: variant.height, durationMs: variant.durationMs });
    } else {
      assertMediaMetadata(video ? { kind: 'PHOTO', contentType: 'image/webp', byteLength: variant.byteLength } : intent,
        { width: variant.width, height: variant.height, frames: 1 });
      if ((video && Math.max(variant.width, variant.height) > 640) || (intent.kind === 'AVATAR' && Math.max(variant.width, variant.height) > 512)) throw new Error('decoder_protocol');
    }
  }
  return value as unknown as DecoderResponse;
}

// One bounded chunk at a time. Each payload consumes exactly its manifest length,
// preserving coalesced next-payload bytes in the socket's bounded readable buffer.
async function nextBytes(socket: Socket, maximum: number, signal: AbortSignal): Promise<Buffer | null> {
  for (;;) {
    if (signal.aborted) throw new Error('decoder_aborted');
    const chunk = socket.read(Math.min(maximum, socket.readableLength || maximum)) as Buffer | null;
    if (chunk !== null) return chunk;
    if (socket.readableEnded) return null;
    if (socket.destroyed) throw new Error('decoder_closed');
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { socket.off('readable', ready); socket.off('end', ready); socket.off('close', closed); socket.off('error', closed); signal.removeEventListener('abort', closed); };
      const ready = () => { cleanup(); resolve(); };
      const closed = () => { cleanup(); reject(new Error('decoder_closed')); };
      socket.once('readable', ready); socket.once('end', ready); socket.once('close', closed); socket.once('error', closed); signal.addEventListener('abort', closed, { once: true });
      if (signal.aborted || socket.destroyed) closed();
    });
  }
}
export function payloadStream(socket: Socket, byteLength: number, signal: AbortSignal): Readable {
  const controller = new AbortController();
  const combined = AbortSignal.any([signal, controller.signal]);
  const stream = Readable.from((async function* () {
    let remaining = byteLength;
    while (remaining > 0) {
      const chunk = await nextBytes(socket, Math.min(remaining, 64 * 1024), combined);
      if (!chunk) throw new Error('decoder_truncated');
      remaining -= chunk.length; yield chunk;
    }
  })(), { objectMode: false, highWaterMark: 64 * 1024 });
  // A spool idle/disk failure destroys this source independently of the caller
  // signal. Release a pending socket read before awaiting generator teardown.
  const destroy = stream._destroy;
  stream._destroy = (error, callback) => { controller.abort(); destroy.call(stream, error, callback); };
  return stream;
}
export async function assertDecoderEnd(socket: Socket, signal: AbortSignal): Promise<void> {
  if (await nextBytes(socket, 1, signal) !== null) throw new Error('decoder_trailing_bytes');
}
