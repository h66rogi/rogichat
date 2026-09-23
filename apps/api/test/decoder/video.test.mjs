// Explicit native-decoder suite: ffmpeg/ffprobe (libx264, libwebp, AAC) are required, never silently skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { decodeVideo } from '../../dist/isolated/media-decoder/video-decoder.js';

const exec = promisify(execFile);
const binaries = {
  ffmpeg: process.env.ROGICHAT_TEST_FFMPEG ?? (process.platform === 'darwin' ? '/opt/homebrew/bin/ffmpeg' : '/usr/bin/ffmpeg'),
  ffprobe: process.env.ROGICHAT_TEST_FFPROBE ?? (process.platform === 'darwin' ? '/opt/homebrew/bin/ffprobe' : '/usr/bin/ffprobe'),
};
async function fixture(t, { audio = true, duration = '1', width = 160, height = 90, pattern = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'rogichat-video-fixture-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = join(dir, 'source.mp4');
  const pixels = `color=c=${pattern ? 'red' : 'orange'}:s=${width}x${height}:r=30${pattern ? ',drawbox=x=iw/2:y=0:w=iw/2:h=ih:color=blue:t=fill' : ''}`;
  await exec(binaries.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-f', 'lavfi', '-i', pixels,
    ...(audio ? ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000'] : []),
    '-t', duration, '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', ...(audio ? ['-c:a', 'aac'] : ['-an']),
    '-metadata', 'title=private-test-title', '-metadata', 'location=+37.0000+127.0000/', '-movflags', '+faststart', input],
  { timeout: 15000, maxBuffer: 64 * 1024, env: { LANG: 'C' } });
  return { dir, input, output: join(dir, 'result') };
}
async function intent(input) { return { kind: 'VIDEO', contentType: 'video/mp4', byteLength: (await stat(input)).size }; }
async function probe(path) {
  const { stdout } = await exec(binaries.ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], { maxBuffer: 32768 });
  return JSON.parse(stdout);
}

test('real MP4 fully reencodes H264/AAC with canonical poster and no source location/title metadata', async t => {
  const { input, output } = await fixture(t);
  const result = await decodeVideo(input, output, await intent(input), binaries);
  assert.equal(result.video.contentType, 'video/mp4');
  assert.equal(result.video.width, 160); assert.equal(result.video.height, 90);
  assert.ok(result.video.durationMs >= 1000 && result.video.durationMs <= 1100);
  assert.equal(result.video.byteLength, (await stat(result.video.path)).size);
  assert.equal((await stat(result.video.path)).mode & 0o777, 0o600);
  assert.equal((await stat(output)).mode & 0o777, 0o700);
  assert.equal(result.poster.contentType, 'image/webp');
  assert.ok(result.poster.width <= 640 && result.poster.height <= 640);
  const metadata = await probe(result.video.path);
  assert.deepEqual(metadata.streams.map(stream => stream.codec_name), ['h264', 'aac']);
  assert.equal(metadata.streams[0].pix_fmt, 'yuv420p');
  assert.equal(metadata.streams[0].avg_frame_rate, '30/1');
  assert.ok(!JSON.stringify(metadata).includes('private-test-title'));
  assert.ok(!JSON.stringify(metadata).includes('+37.0000'));
});

test('silent and rotated smartphone-style MP4 preserve visible orientation without rotation metadata', async t => {
  const { input, dir } = await fixture(t, { audio: false, pattern: true });
  for (const degrees of [90, 180, 270]) {
    const rotated = join(dir, `rotated-${degrees}.mp4`);
    await exec(binaries.ffmpeg, ['-v', 'error', '-nostdin', '-n', '-i', input, '-c', 'copy', '-metadata:s:v:0', `rotate=${degrees}`, rotated]);
    assert.ok((await probe(rotated)).streams[0].side_data_list?.some(side => side.side_data_type === 'Display Matrix' && side.rotation !== 0));
    const result = await decodeVideo(rotated, join(dir, `result-${degrees}`), await intent(rotated), binaries);
    assert.equal(result.video.width, degrees === 180 ? 160 : 90); assert.equal(result.video.height, degrees === 180 ? 90 : 160);
    const metadata = await probe(result.video.path);
    assert.equal(metadata.streams.length, 1);
    assert.ok(!metadata.streams[0].side_data_list?.some(side => side.side_data_type === 'Display Matrix' && side.rotation));
    const expected = degrees === 90 ? ['blue', 'blue', 'red', 'red'] : degrees === 180 ? ['blue', 'red', 'blue', 'red'] : ['red', 'red', 'blue', 'blue'];
    for (const path of [result.video.path, result.poster.path]) {
      const { stdout: pixels } = await exec(binaries.ffmpeg, ['-v', 'error', '-i', path, '-vf', 'format=rgb24,scale=2:2:flags=neighbor', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer', maxBuffer: 4096 });
      assert.equal(pixels.length, 12);
      expected.forEach((color, index) => assert.ok(color === 'red' ? pixels[index * 3] > pixels[index * 3 + 2] + 80 : pixels[index * 3 + 2] > pixels[index * 3] + 80, `pixel ${index} must be ${color} at ${degrees} degrees`));
    }
  }
});

test('abort during poster postprocessing cannot return success and removes both outputs', async t => {
  const { input, output } = await fixture(t, { audio: false });
  const controller = new globalThis.AbortController();
  const original = sharp.prototype.stats;
  sharp.prototype.stats = async function (...args) { controller.abort(); return original.apply(this, args); };
  try {
    await assert.rejects(decodeVideo(input, output, await intent(input), binaries, controller.signal), { message: 'INVALID_VIDEO' });
    await assert.rejects(stat(output), { code: 'ENOENT' });
  } finally { sharp.prototype.stats = original; }
});

test('invalid or over-duration input cleans owned outputs and leaves original input untouched', async t => {
  const { input, output, dir } = await fixture(t, { duration: '61', width: 32, height: 32, audio: false });
  await assert.rejects(decodeVideo(input, output, await intent(input), binaries), { message: 'INVALID_VIDEO' });
  await assert.rejects(stat(output), { code: 'ENOENT' });
  const truncated = join(dir, 'truncated.mp4');
  const source = await readFile(input); await writeFile(truncated, source.subarray(0, Math.floor(source.length / 2)));
  const before = await readFile(truncated);
  await assert.rejects(decodeVideo(truncated, output, await intent(truncated), binaries), { message: 'INVALID_VIDEO' });
  assert.deepEqual(await readFile(truncated), before);
  await assert.rejects(stat(output), { code: 'ENOENT' });
});

test('existing output, symlink input, mismatched size, abort and concurrent operation fail closed', async t => {
  const { input, output, dir } = await fixture(t, { audio: false });
  await writeFile(output, 'preserve-user-file');
  await assert.rejects(decodeVideo(input, output, await intent(input), binaries), { message: 'INVALID_VIDEO_PATH' });
  assert.equal(await readFile(output, 'utf8'), 'preserve-user-file');
  const linked = join(dir, 'linked.mp4'); await symlink(input, linked);
  await assert.rejects(decodeVideo(linked, join(dir, 'linked-output'), await intent(input), binaries), { message: 'INVALID_VIDEO' });
  await assert.rejects(decodeVideo(input, join(dir, 'wrong-size'), { ...await intent(input), byteLength: 20 }, binaries), { message: 'INVALID_VIDEO' });
  const controller = new globalThis.AbortController();
  const sourceIntent = await intent(input);
  const operation = decodeVideo(input, join(dir, 'aborted'), sourceIntent, binaries, controller.signal);
  await assert.rejects(decodeVideo(input, join(dir, 'concurrent'), sourceIntent, binaries), { message: 'VIDEO_DECODER_BUSY' });
  controller.abort();
  await assert.rejects(operation, { message: 'INVALID_VIDEO' });
  await assert.rejects(stat(join(dir, 'aborted')), { code: 'ENOENT' });
});
