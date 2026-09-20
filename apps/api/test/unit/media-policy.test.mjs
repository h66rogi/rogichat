import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEDIA_LIMITS, MEDIA_CONTENT_TYPES, MediaPolicyError, parseMediaIntent, assertPhotoCount,
  assertMediaSignature, assertMediaMetadata } from '../../dist/common/media/media-policy.js';

const context = { canRegisterStickers: false };
const intent = (contentType = 'image/png', kind = 'PHOTO', byteLength = 100) => ({ kind, contentType, byteLength });
const errorCode = code => error => error instanceof MediaPolicyError && error.code === code && error.message === code;
const invalid = errorCode('INVALID_MEDIA_INTENT');
const mismatch = errorCode('MEDIA_SIGNATURE_MISMATCH');
const badMetadata = errorCode('INVALID_MEDIA_METADATA');

test('strict intents accept exactly allowed MIME and inclusive byte caps, with immutable policy', () => {
  assert.ok(Object.isFrozen(MEDIA_LIMITS)); assert.ok(Object.isFrozen(MEDIA_CONTENT_TYPES));
  for (const [kind, types] of Object.entries(MEDIA_CONTENT_TYPES)) {
    assert.ok(Object.isFrozen(types));
    const cap = MEDIA_LIMITS[`${kind.toLowerCase()}Bytes`];
    for (const contentType of types) {
      const input = intent(contentType, kind, cap);
      assert.deepEqual(parseMediaIntent(input, { canRegisterStickers: true }), input);
      assert.ok(Object.isFrozen(parseMediaIntent(input, { canRegisterStickers: true })));
      assert.throws(() => parseMediaIntent({ ...input, byteLength: cap + 1 }, { canRegisterStickers: true }), invalid);
    }
  }
  for (const byteLength of [undefined, null, '1', 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseMediaIntent({ ...intent(), byteLength }, context), invalid);
  }
  for (const contentType of ['image/gif', 'image/svg+xml', 'image/jpg', 'IMAGE/PNG', 'image/png; charset=utf-8', '', null]) {
    assert.throws(() => parseMediaIntent(intent(contentType), context), invalid);
  }
  for (const input of [null, [], 'x', {}, { ...intent(), bucket: 'caller' }, { ...intent(), key: 'caller' },
    { ...intent(), canRegisterStickers: true }, { ...intent(), kind: '__proto__' },
    { ...intent(), [Symbol('extra')]: 1 }, Object.create(intent())]) {
    assert.throws(() => parseMediaIntent(input, context), invalid);
  }
  assert.throws(() => parseMediaIntent(intent('image/jpeg', 'STICKER'), { canRegisterStickers: true }), invalid);
  assert.throws(() => parseMediaIntent(intent('video/mp4', 'PHOTO'), context), invalid);
  assert.throws(() => parseMediaIntent(intent(), {}), invalid);
});

test('only trusted capability permits sticker intent; attachment count is bounded independently', () => {
  assert.throws(() => parseMediaIntent(intent('image/png', 'STICKER'), context), errorCode('MEDIA_FORBIDDEN'));
  assert.equal(parseMediaIntent(intent('image/png', 'STICKER'), { canRegisterStickers: true }).kind, 'STICKER');
  for (const count of [0, 1, 4]) assertPhotoCount(count);
  for (const count of [-1, 5, 1.5, '4', undefined, null, NaN, Infinity]) assert.throws(() => assertPhotoCount(count), invalid);
});

function webp(byteLength = 100, chunk = 'VP8 ') {
  const bytes = Buffer.alloc(20); bytes.write('RIFF'); bytes.writeUInt32LE(byteLength - 8, 4);
  bytes.write('WEBP', 8); bytes.write(chunk, 12); bytes.writeUInt32LE(byteLength - 20, 16); return bytes;
}
function ftyp(major = 'isom', compatible = ['mp42'], extended = false) {
  const header = extended ? 16 : 8; const size = header + 8 + compatible.length * 4;
  const bytes = Buffer.alloc(size); bytes.writeUInt32BE(extended ? 1 : size); bytes.write('ftyp', 4);
  if (extended) bytes.writeBigUInt64BE(BigInt(size), 8);
  bytes.write(major, header); compatible.forEach((brand, index) => bytes.write(brand, header + 8 + index * 4)); return bytes;
}

test('bounded image signature screening is exact and never claims decoding or static-image proof', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff]); const png = Buffer.from('89504e470d0a1a0a', 'hex');
  assertMediaSignature(intent('image/jpeg'), jpeg); assertMediaSignature(intent(), png);
  for (const chunk of ['VP8 ', 'VP8L', 'VP8X']) assertMediaSignature(intent('image/webp'), webp(100, chunk));
  // A header with no decodable image still passes this preliminary check. Only full decoder
  // metadata can establish static frames; VP8X and PNG may encode animations after this prefix.
  assertMediaSignature(intent('image/png', 'PHOTO', 8), png);
  for (const prefix of [Buffer.alloc(0), png.subarray(0, 7), Buffer.alloc(4097), new Uint8Array(png), jpeg]) {
    assert.throws(() => assertMediaSignature(intent(), prefix), mismatch);
  }
  assert.throws(() => assertMediaSignature(intent('image/png', 'PHOTO', 7), png), mismatch);
  assert.throws(() => assertMediaSignature(intent('image/jpeg'), png), mismatch);
  for (const prefix of [webp(102), webp(100, 'ANIM'), webp().subarray(0, 19)]) {
    assert.throws(() => assertMediaSignature(intent('image/webp'), prefix), mismatch);
  }
  const oversized = webp(); oversized.writeUInt32LE(81, 16);
  assert.throws(() => assertMediaSignature(intent('image/webp'), oversized), mismatch);
  const spoofed = webp(); spoofed[0] |= 0x80;
  assert.throws(() => assertMediaSignature(intent('image/webp'), spoofed), mismatch);
});

test('ISO media signatures bound ftyp parsing, skip minor version and distinguish QuickTime', () => {
  const mp4 = intent('video/mp4', 'VIDEO'); const mov = intent('video/quicktime', 'VIDEO');
  for (const prefix of [ftyp(), ftyp('mp42', []), ftyp('isom', ['mp41'], true)]) assertMediaSignature(mp4, prefix);
  assertMediaSignature(mov, ftyp('qt  ', []));
  assert.throws(() => assertMediaSignature(mp4, ftyp('qt  ', [])), mismatch);
  assert.throws(() => assertMediaSignature(mov, ftyp()), mismatch);
  for (const prefix of [ftyp('isom', []), ftyp('avif', ['mp42']), ftyp('mif1', ['avif']), Buffer.from('000000086d6f6f76', 'hex')]) {
    assert.throws(() => assertMediaSignature(mp4, prefix), mismatch);
  }
  const minorVersion = ftyp('isom', []); minorVersion.write('mp42', 12);
  assert.throws(() => assertMediaSignature(mp4, minorVersion), mismatch);
  for (const size of [0, 8, 15, 19, 24, 4096]) {
    const prefix = ftyp(); prefix.writeUInt32BE(size);
    assert.throws(() => assertMediaSignature(mp4, prefix), mismatch);
  }
  const overflow = ftyp('isom', ['mp42'], true); overflow.writeBigUInt64BE(2n ** 63n, 8);
  assert.throws(() => assertMediaSignature(mp4, overflow), mismatch);
  for (const offset of [4, 8, 16]) {
    const spoofed = ftyp(); spoofed[offset] |= 0x80;
    assert.throws(() => assertMediaSignature(mp4, spoofed), mismatch);
  }
  assert.throws(() => assertMediaSignature(mp4, ftyp().subarray(0, 19)), mismatch);
});

test('decoded image metadata enforces explicit static frames, 20MP and sticker dimensions', () => {
  for (const kind of ['PHOTO', 'AVATAR']) assertMediaMetadata(intent('image/png', kind), { width: 5000, height: 4000, frames: 1 });
  assertMediaMetadata(intent('image/png', 'STICKER'), { width: 512, height: 512, frames: 1 });
  for (const kind of ['PHOTO', 'AVATAR', 'STICKER']) {
    for (const frames of [undefined, 0, 2, '1', 1.5, Infinity]) {
      assert.throws(() => assertMediaMetadata(intent('image/png', kind), { width: 1, height: 1, frames }), badMetadata);
    }
  }
  for (const metadata of [null, {}, { width: 5001, height: 4000, frames: 1 },
    { width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER, frames: 1 },
    { width: 0, height: 1, frames: 1 }, { width: '1', height: 1, frames: 1 },
    { width: 1, height: 1.5, frames: 1 }, { width: 1, height: 1, frames: 1, durationMs: 0 },
    { width: 1, height: 1, frames: 1, ready: true }]) {
    assert.throws(() => assertMediaMetadata(intent(), metadata), badMetadata);
  }
  for (const metadata of [{ width: 513, height: 1, frames: 1 }, { width: 1, height: 513, frames: 1 }]) {
    assert.throws(() => assertMediaMetadata(intent('image/webp', 'STICKER'), metadata), badMetadata);
  }
});

test('decoded video metadata limits duration and rotated display edges, never requires one frame', () => {
  const video = intent('video/mp4', 'VIDEO');
  for (const [width, height] of [[1920, 1080], [1080, 1920]]) {
    assertMediaMetadata(video, { width, height, durationMs: 60000, frames: 1800 });
    assertMediaMetadata(video, { width, height, durationMs: 0.5 });
  }
  for (const durationMs of [undefined, 0, -1, 60000.1, Infinity, NaN, '1000']) {
    assert.throws(() => assertMediaMetadata(video, { width: 1920, height: 1080, durationMs }), badMetadata);
  }
  for (const [width, height] of [[1921, 1080], [1080, 1921], [1081, 1081], [1920, 1081]]) {
    assert.throws(() => assertMediaMetadata(video, { width, height, durationMs: 1 }), badMetadata);
  }
  assert.throws(() => assertMediaMetadata(video, { width: 1, height: 1, durationMs: 1, frames: 0 }), badMetadata);
});
