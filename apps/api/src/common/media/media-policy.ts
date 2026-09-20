export type MediaKind = 'PHOTO' | 'AVATAR' | 'STICKER' | 'VIDEO';
export type MediaContentType = 'image/jpeg' | 'image/png' | 'image/webp' | 'video/mp4' | 'video/quicktime';
export interface MediaIntent { kind: MediaKind; contentType: MediaContentType; byteLength: number }
export interface MediaContext { canRegisterStickers: boolean }
export interface MediaMetadata { width: number; height: number; frames?: number; durationMs?: number }
export type MediaPolicyCode = 'INVALID_MEDIA_INTENT' | 'MEDIA_FORBIDDEN' | 'MEDIA_SIGNATURE_MISMATCH' | 'INVALID_MEDIA_METADATA';
export class MediaPolicyError extends Error {
  constructor(readonly code: MediaPolicyCode) { super(code); }
}

export const MEDIA_LIMITS = Object.freeze({
  photoBytes: 10 * 1024 * 1024, avatarBytes: 10 * 1024 * 1024, stickerBytes: 1024 * 1024,
  videoBytes: 50 * 1024 * 1024, photoCount: 4, maxPixels: 20_000_000,
  stickerWidth: 512, stickerHeight: 512, videoLongEdge: 1920, videoShortEdge: 1080,
  videoDurationMs: 60_000, signaturePrefixBytes: 4096,
});
export const MEDIA_CONTENT_TYPES: Readonly<Record<MediaKind, readonly MediaContentType[]>> = Object.freeze({
  PHOTO: Object.freeze(['image/jpeg', 'image/png', 'image/webp'] as const),
  AVATAR: Object.freeze(['image/jpeg', 'image/png', 'image/webp'] as const),
  STICKER: Object.freeze(['image/png', 'image/webp'] as const),
  VIDEO: Object.freeze(['video/mp4', 'video/quicktime'] as const),
});
const caps: Readonly<Record<MediaKind, number>> = Object.freeze({ PHOTO: MEDIA_LIMITS.photoBytes, AVATAR: MEDIA_LIMITS.avatarBytes, STICKER: MEDIA_LIMITS.stickerBytes, VIDEO: MEDIA_LIMITS.videoBytes });
function object(value: unknown, keys: readonly string[], code: MediaPolicyCode): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.includes(key))) throw new MediaPolicyError(code);
}
function positive(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }

// Authorization comes from a fresh server-side capability check, never a field of the upload body.
export function parseMediaIntent(input: unknown, context: MediaContext): Readonly<MediaIntent> {
  object(input, ['kind', 'contentType', 'byteLength'], 'INVALID_MEDIA_INTENT');
  if (!context || typeof context.canRegisterStickers !== 'boolean' ||
      typeof input.kind !== 'string' || !Object.hasOwn(MEDIA_CONTENT_TYPES, input.kind) ||
      typeof input.contentType !== 'string' || !positive(input.byteLength)) throw new MediaPolicyError('INVALID_MEDIA_INTENT');
  const kind = input.kind as MediaKind;
  if (!MEDIA_CONTENT_TYPES[kind].includes(input.contentType as MediaContentType) || input.byteLength > caps[kind]) throw new MediaPolicyError('INVALID_MEDIA_INTENT');
  if (kind === 'STICKER' && !context.canRegisterStickers) throw new MediaPolicyError('MEDIA_FORBIDDEN');
  return Object.freeze({ kind, contentType: input.contentType as MediaContentType, byteLength: input.byteLength });
}
export function assertPhotoCount(count: unknown): void {
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || count > MEDIA_LIMITS.photoCount) throw new MediaPolicyError('INVALID_MEDIA_INTENT');
}

const jpeg = Buffer.from([0xff, 0xd8, 0xff]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const mp4MajorBrands = new Set(['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'iso7', 'iso8', 'iso9', 'mp41', 'mp42', 'avc1', 'M4V ']);
const mp4SpecificBrands = new Set(['mp41', 'mp42', 'avc1', 'M4V ']);
function fileTypeBrands(prefix: Buffer, byteLength: number): string[] | undefined {
  if (prefix.length < 16 || prefix.toString('latin1', 4, 8) !== 'ftyp') return;
  let size = prefix.readUInt32BE(0); let header = 8;
  if (size === 1) {
    if (prefix.length < 24) return;
    const wide = prefix.readBigUInt64BE(8);
    if (wide > BigInt(MEDIA_LIMITS.signaturePrefixBytes)) return;
    size = Number(wide); header = 16;
  }
  if (size < header + 8 || size > prefix.length || size > byteLength || (size - header) % 4 !== 0) return;
  const brands = [prefix.toString('latin1', header, header + 4)];
  // Skip the minor-version word, which is not a brand.
  for (let offset = header + 8; offset < size; offset += 4) brands.push(prefix.toString('latin1', offset, offset + 4));
  return brands;
}

// Bounded signature screening only, NOT an image/video decoder or READY proof. Prefixes cannot
// prove complete bytes, valid pixels/frames, track presence, codecs, duration, or absence of polyglots.
// Caller must independently match streamed bytes to the intent and run isolated full decode/re-encode.
// Signatures: WHATWG MIME sniffing; WebP RIFF container; Apple QTFF ftyp; MP4RA registered brands.
export function assertMediaSignature(intent: MediaIntent, prefix: Buffer): void {
  const checked = parseMediaIntent(intent, { canRegisterStickers: true });
  if (!Buffer.isBuffer(prefix) || prefix.length === 0 || prefix.length > MEDIA_LIMITS.signaturePrefixBytes || prefix.length > checked.byteLength) throw new MediaPolicyError('MEDIA_SIGNATURE_MISMATCH');
  let matches = false;
  if (checked.contentType === 'image/jpeg') matches = prefix.subarray(0, jpeg.length).equals(jpeg);
  if (checked.contentType === 'image/png') matches = prefix.subarray(0, png.length).equals(png);
  if (checked.contentType === 'image/webp' && prefix.length >= 20) {
    matches = prefix.toString('latin1', 0, 4) === 'RIFF' && prefix.toString('latin1', 8, 12) === 'WEBP' &&
      prefix.readUInt32LE(4) + 8 === checked.byteLength && checked.byteLength % 2 === 0 &&
      ['VP8 ', 'VP8L', 'VP8X'].includes(prefix.toString('latin1', 12, 16)) &&
      prefix.readUInt32LE(16) <= checked.byteLength - 20;
  }
  if (checked.kind === 'VIDEO') {
    const brands = fileTypeBrands(prefix, checked.byteLength);
    // Generic ISOBMFF alone is not specific to video (HEIF/AVIF also use ftyp).
    if (brands) matches = checked.contentType === 'video/quicktime' ? brands[0] === 'qt  ' :
      mp4MajorBrands.has(brands[0]!) && brands.some(brand => mp4SpecificBrands.has(brand));
  }
  if (!matches) throw new MediaPolicyError('MEDIA_SIGNATURE_MISMATCH');
}

// Accept ONLY metadata produced by the isolated decoder, never request JSON. Images must have
// an explicit single-frame result: PNG/WebP signatures alone cannot rule out animation.
// Video dimensions are display-oriented (after rotation), allowing both landscape and portrait.
export function assertMediaMetadata(intent: MediaIntent, metadata: MediaMetadata): void {
  const checked = parseMediaIntent(intent, { canRegisterStickers: true });
  object(metadata, ['width', 'height', 'frames', 'durationMs'], 'INVALID_MEDIA_METADATA');
  if (!positive(metadata.width) || !positive(metadata.height) || metadata.width > Math.floor(MEDIA_LIMITS.maxPixels / metadata.height)) throw new MediaPolicyError('INVALID_MEDIA_METADATA');
  if (metadata.frames !== undefined && !positive(metadata.frames)) throw new MediaPolicyError('INVALID_MEDIA_METADATA');
  if (checked.kind === 'VIDEO') {
    if (typeof metadata.durationMs !== 'number' || !Number.isFinite(metadata.durationMs) || metadata.durationMs <= 0 || metadata.durationMs > MEDIA_LIMITS.videoDurationMs ||
      Math.max(metadata.width, metadata.height) > MEDIA_LIMITS.videoLongEdge || Math.min(metadata.width, metadata.height) > MEDIA_LIMITS.videoShortEdge) throw new MediaPolicyError('INVALID_MEDIA_METADATA');
  } else {
    if (metadata.frames !== 1 || metadata.durationMs !== undefined) throw new MediaPolicyError('INVALID_MEDIA_METADATA');
    if (checked.kind === 'STICKER' && (metadata.width > MEDIA_LIMITS.stickerWidth || metadata.height > MEDIA_LIMITS.stickerHeight)) throw new MediaPolicyError('INVALID_MEDIA_METADATA');
  }
}
