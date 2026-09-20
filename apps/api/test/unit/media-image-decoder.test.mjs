import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { decodeImage, ImageDecodeError, IMAGE_OUTPUT_LIMITS } from '../../dist/isolated/media-decoder/media-image-decoder.js';

const invalid = error => error instanceof ImageDecodeError && error.code === 'INVALID_IMAGE' && error.message === 'INVALID_IMAGE';
const pathError = error => error instanceof ImageDecodeError && error.code === 'INVALID_IMAGE_PATH';
const image = (width = 32, height = 16) => sharp({ create: { width, height, channels: 4, background: { r: 255, g: 80, b: 10, alpha: 0.5 } } });
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'rogichat-decoder-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, input: join(dir, 'input'), output: join(dir, 'output.webp') };
}
async function intent(input, contentType = 'image/png', kind = 'PHOTO') {
  return { kind, contentType, byteLength: (await stat(input)).size };
}
async function absent(path) { await assert.rejects(stat(path), { code: 'ENOENT' }); }

test('real JPEG, PNG and WebP decode to bounded canonical WebP with stripped metadata and EXIF rotation', async t => {
  const { dir } = await fixture(t);
  for (const [format, type] of [['jpeg', 'image/jpeg'], ['png', 'image/png'], ['webp', 'image/webp']]) {
    const input = join(dir, `source.${format}`); const output = join(dir, `${format}.webp`);
    await image().withMetadata({ orientation: 6 }).withExifMerge({ IFD0: { Artist: 'test-only-private-metadata' } })[format]().toFile(input);
    assert.ok((await sharp(input).metadata()).exif);
    const result = await decodeImage(input, output, await intent(input, type));
    assert.deepEqual(result, { contentType: 'image/webp', byteLength: (await stat(output)).size, width: 16, height: 32 });
    assert.ok(Object.isFrozen(result));
    const meta = await sharp(output).metadata();
    for (const field of ['exif', 'xmp', 'iptc', 'icc', 'orientation']) assert.equal(meta[field], undefined);
    assert.ok(result.byteLength <= IMAGE_OUTPUT_LIMITS.PHOTO);
    await sharp(output).stats();
  }
});

test('avatar resizes inside 512 without enlargement; stickers must already satisfy 512 bounds', async t => {
  const { dir, input, output } = await fixture(t);
  await image(1024, 512).png().toFile(input);
  const avatar = await decodeImage(input, output, await intent(input, 'image/png', 'AVATAR'));
  assert.equal(avatar.width, 512); assert.equal(avatar.height, 256);
  assert.ok(avatar.byteLength <= IMAGE_OUTPUT_LIMITS.AVATAR);
  await assert.rejects(decodeImage(input, join(dir, 'sticker-denied.webp'), await intent(input, 'image/png', 'STICKER')), invalid);
  await absent(join(dir, 'sticker-denied.webp'));
  const small = join(dir, 'small.png'); await image(20, 10).png().toFile(small);
  const smallAvatar = await decodeImage(small, join(dir, 'small.webp'), await intent(small, 'image/png', 'AVATAR'));
  assert.equal(smallAvatar.width, 20); assert.equal(smallAvatar.height, 10);
  const sticker = await decodeImage(small, join(dir, 'sticker.webp'), await intent(small, 'image/png', 'STICKER'));
  assert.ok(sticker.byteLength <= IMAGE_OUTPUT_LIMITS.STICKER);
});

test('animation is denied for actual multi-page WebP and APNG even when PNG decoder sees only default frame', async t => {
  const { dir, input, output } = await fixture(t);
  const pixels = Buffer.alloc(8 * 16 * 3); pixels.fill(255, 8 * 8 * 3);
  await sharp(pixels, { raw: { width: 8, height: 16, pageHeight: 8, channels: 3 } }).webp({ loop: 0, delay: [100, 100] }).toFile(input);
  assert.equal((await sharp(input).metadata()).pages, 2);
  await assert.rejects(decodeImage(input, output, await intent(input, 'image/webp')), invalid);
  await absent(output);
  const pngPath = join(dir, 'static.png'); await image().png().toFile(pngPath);
  const png = await readFile(pngPath);
  const animation = Buffer.alloc(20); animation.writeUInt32BE(8); animation.write('acTL', 4); animation.writeUInt32BE(2, 8);
  animation.writeUInt32BE(crc32(animation.subarray(4, 16)), 16);
  // Insert a genuine animation-control chunk after IHDR, before default-image IDAT.
  await writeFile(pngPath, Buffer.concat([png.subarray(0, 33), animation, png.subarray(33)]));
  await assert.rejects(decodeImage(pngPath, output, await intent(pngPath)), invalid);
  await absent(output);
});

test('oversized pixel dimensions, unsupported formats, declared format/length mismatch and video all fail closed', async t => {
  const { dir, input, output } = await fixture(t);
  await image(5001, 4000).png().toFile(input);
  await assert.rejects(decodeImage(input, output, await intent(input)), invalid);
  await absent(output);
  const gif = join(dir, 'image.gif'); await image().gif().toFile(gif);
  await assert.rejects(decodeImage(gif, output, await intent(gif)), invalid);
  const png = join(dir, 'image.png'); await image().png().toFile(png);
  await assert.rejects(decodeImage(png, output, await intent(png, 'image/jpeg')), invalid);
  await assert.rejects(decodeImage(png, output, { ...await intent(png), byteLength: 1 }), invalid);
  await assert.rejects(decodeImage(png, output, await intent(png, 'video/mp4', 'VIDEO')), invalid);
  await absent(output);
});

test('full pixel decoding rejects truncated JPEG and partial outputs are removed without touching input', async t => {
  const { input, output } = await fixture(t);
  await image(256, 256).jpeg().toFile(input);
  const complete = await readFile(input); const truncated = complete.subarray(0, Math.floor(complete.length * 0.8));
  await writeFile(input, truncated);
  await assert.rejects(decodeImage(input, output, await intent(input, 'image/jpeg')), invalid);
  assert.deepEqual(await readFile(input), truncated); await absent(output);
});

test('trusted-path boundary rejects relative, same, symlink and existing output paths without overwrites', async t => {
  const { dir, input, output } = await fixture(t);
  await image().png().toFile(input); const declared = await intent(input);
  await assert.rejects(decodeImage('relative.png', output, declared), pathError);
  await assert.rejects(decodeImage(input, input, declared), pathError);
  await writeFile(output, 'existing-output');
  await assert.rejects(decodeImage(input, output, declared), pathError);
  assert.equal(await readFile(output, 'utf8'), 'existing-output');
  const link = join(dir, 'input-link'); await symlink(input, link);
  await assert.rejects(decodeImage(link, join(dir, 'other.webp'), declared), pathError);
  const outLink = join(dir, 'output-link'); await symlink(output, outLink);
  await assert.rejects(decodeImage(input, outLink, declared), pathError);
  assert.equal(await readFile(output, 'utf8'), 'existing-output');
});

test('only one active image decode is permitted in each isolated process', async t => {
  const { dir, input, output } = await fixture(t); await image().png().toFile(input); const declared = await intent(input);
  const first = decodeImage(input, output, declared);
  await assert.rejects(decodeImage(input, join(dir, 'second.webp'), declared), error => error instanceof ImageDecodeError && error.code === 'IMAGE_DECODER_BUSY');
  await first;
});
