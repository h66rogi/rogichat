import { constants } from 'node:fs';
import { open, stat, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import sharp from 'sharp';
import { assertMediaMetadata, assertMediaSignature, MEDIA_LIMITS, parseMediaIntent } from '../../common/media/media-policy.js';
import type { MediaIntent } from '../../common/media/media-policy.js';

export type ImageDecodeCode = 'INVALID_IMAGE' | 'IMAGE_OUTPUT_TOO_LARGE' | 'INVALID_IMAGE_PATH' | 'IMAGE_DECODER_BUSY';
export class ImageDecodeError extends Error {
  constructor(readonly code: ImageDecodeCode) { super(code); }
}
export interface DecodedImage { contentType: 'image/webp'; byteLength: number; width: number; height: number }
export const IMAGE_OUTPUT_LIMITS = Object.freeze({ PHOTO: 10 * 1024 * 1024, AVATAR: 2 * 1024 * 1024, STICKER: 1024 * 1024 });
const inputOptions = Object.freeze({ failOn: 'warning' as const, limitInputPixels: MEDIA_LIMITS.maxPixels, limitInputChannels: 4, sequentialRead: true });
let active = false;

async function bytesAt(file: FileHandle, position: number, count: number): Promise<Buffer> {
  const bytes = Buffer.alloc(count); const read = await file.read(bytes, 0, count, position);
  if (read.bytesRead !== count) throw new ImageDecodeError('INVALID_IMAGE');
  return bytes;
}

// libvips can expose APNG's default frame as an ordinary PNG. Reject animation chunks
// independently of decoder metadata. Walk only bounded headers, never buffer the file.
async function assertStaticContainer(file: FileHandle, intent: MediaIntent): Promise<void> {
  if (intent.contentType !== 'image/png' && intent.contentType !== 'image/webp') return;
  const png = intent.contentType === 'image/png'; let offset = png ? 8 : 12; let chunks = 0;
  while (offset < intent.byteLength) {
    if (++chunks > 100_000 || intent.byteLength - offset < (png ? 12 : 8)) throw new ImageDecodeError('INVALID_IMAGE');
    const header = await bytesAt(file, offset, 8);
    const length = png ? header.readUInt32BE(0) : header.readUInt32LE(4);
    const kind = png ? header.toString('latin1', 4, 8) : header.toString('latin1', 0, 4);
    const end = offset + 8 + length + (png ? 4 : length % 2);
    if (end > intent.byteLength) throw new ImageDecodeError('INVALID_IMAGE');
    if (png ? ['acTL', 'fcTL', 'fdAT'].includes(kind) : ['ANIM', 'ANMF'].includes(kind)) throw new ImageDecodeError('INVALID_IMAGE');
    if (!png && kind === 'VP8X') {
      if (length < 10 || ((await bytesAt(file, offset + 8, 1))[0]! & 0x02) !== 0) throw new ImageDecodeError('INVALID_IMAGE');
    }
    if (png && kind === 'IEND') {
      if (length !== 0 || end !== intent.byteLength) throw new ImageDecodeError('INVALID_IMAGE');
      return;
    }
    offset = end;
  }
  if (png || offset !== intent.byteLength) throw new ImageDecodeError('INVALID_IMAGE');
}

/** Isolated decoder entrypoint ONLY. Never import into API/worker execution paths.
 * Caller supplies trusted immutable local paths in an exclusive scratch directory and must
 * enforce network-none, no credentials/mounts, CPU/memory/disk caps and an external hard deadline.
 * This function neither authorizes uploads nor marks assets READY. No whole-file toBuffer.
 */
export async function decodeImage(inputPath: string, outputPath: string, intent: MediaIntent): Promise<Readonly<DecodedImage>> {
  if (active) throw new ImageDecodeError('IMAGE_DECODER_BUSY');
  active = true; let outputOwned = false; let input: FileHandle | undefined;
  try {
    if (typeof inputPath !== 'string' || typeof outputPath !== 'string' || !isAbsolute(inputPath) || !isAbsolute(outputPath) ||
        inputPath.includes('\0') || outputPath.includes('\0') || resolve(inputPath) === resolve(outputPath)) throw new ImageDecodeError('INVALID_IMAGE_PATH');
    const checked = parseMediaIntent(intent, { canRegisterStickers: true });
    if (checked.kind === 'VIDEO') throw new ImageDecodeError('INVALID_IMAGE');
    try { input = await open(inputPath, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch { throw new ImageDecodeError('INVALID_IMAGE_PATH'); }
    const source = await input.stat();
    if (!source.isFile() || source.size !== checked.byteLength) throw new ImageDecodeError('INVALID_IMAGE');
    assertMediaSignature(checked, await bytesAt(input, 0, Math.min(source.size, MEDIA_LIMITS.signaturePrefixBytes)));
    await assertStaticContainer(input, checked);
    sharp.cache(false); sharp.concurrency(1);
    const metadata = await sharp(inputPath, inputOptions).metadata();
    const expected = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };
    if (metadata.format !== expected[checked.contentType as keyof typeof expected]) throw new ImageDecodeError('INVALID_IMAGE');
    assertMediaMetadata(checked, { width: metadata.width!, height: metadata.height!, frames: metadata.pages ?? 1 });
    // Exclusive reservation prevents overwriting a caller's existing file or following an output symlink.
    try { const output = await open(outputPath, 'wx', 0o600); outputOwned = true; await output.close(); }
    catch { throw new ImageDecodeError('INVALID_IMAGE_PATH'); }
    let pipeline = sharp(inputPath, inputOptions).rotate();
    if (checked.kind === 'AVATAR') pipeline = pipeline.resize(512, 512, { fit: 'inside', withoutEnlargement: true });
    // No keepMetadata/withMetadata: sharp strips EXIF, XMP, IPTC and ICC by default.
    const result = await pipeline.webp({ quality: 85 }).toFile(outputPath);
    const outputStat = await stat(outputPath);
    if (outputStat.size > IMAGE_OUTPUT_LIMITS[checked.kind]) throw new ImageDecodeError('IMAGE_OUTPUT_TOO_LARGE');
    if (result.format !== 'webp' || result.size !== outputStat.size || outputStat.size <= 0) throw new ImageDecodeError('INVALID_IMAGE');
    assertMediaMetadata(checked, { width: result.width, height: result.height, frames: 1 });
    const verification = sharp(outputPath, inputOptions); const encoded = await verification.metadata();
    if (encoded.format !== 'webp' || (encoded.pages ?? 1) !== 1 || encoded.width !== result.width || encoded.height !== result.height ||
        encoded.exif || encoded.xmp || encoded.iptc || encoded.icc || encoded.orientation !== undefined ||
        (checked.kind === 'AVATAR' && Math.max(result.width, result.height) > 512)) throw new ImageDecodeError('INVALID_IMAGE');
    await verification.stats(); // Force a complete decode of the generated artifact, without a pixel buffer.
    return Object.freeze({ contentType: 'image/webp', byteLength: outputStat.size, width: result.width, height: result.height });
  } catch (error) {
    if (outputOwned) await unlink(outputPath).catch(() => undefined);
    throw error instanceof ImageDecodeError ? error : new ImageDecodeError('INVALID_IMAGE');
  } finally {
    await input?.close().catch(() => undefined); active = false;
  }
}
