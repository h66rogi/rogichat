import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat, readdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { decoderServer } from '../../dist/isolated/media-decoder/media-decoder-server.js';
import { UnixImageDecoder } from '../../dist/modules/media/adapters/media-decoder-client.js';
import { MediaSpooler } from '../../dist/common/media/media-spool.js';

const exec = promisify(execFile);
const binaries = {
  ffmpeg: process.env.ROGICHAT_TEST_FFMPEG ?? (process.platform === 'darwin' ? '/opt/homebrew/bin/ffmpeg' : '/usr/bin/ffmpeg'),
  ffprobe: process.env.ROGICHAT_TEST_FFPROBE ?? (process.platform === 'darwin' ? '/opt/homebrew/bin/ffprobe' : '/usr/bin/ffprobe'),
};
let missing = false;
try { await Promise.all(Object.values(binaries).map(path => access(path))); } catch { missing = true; }

test('native synthetic MP4 crosses actual per-job child and Unix IPC as bounded canonical video and poster',
  { skip: missing ? 'native ffmpeg/ffprobe unavailable' : false }, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'rg-native-ipc-'));
    const input = join(dir, 'input.mp4'); const socket = join(dir, 's'); const server = decoderServer(dir, binaries);
    t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
    await exec(binaries.ffmpeg, ['-v', 'error', '-nostdin', '-n', '-f', 'lavfi', '-i', 'color=c=orange:s=160x90:r=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '1', '-c:v', 'libx264', '-threads', '1',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-metadata', 'title=synthetic-private-title', '-movflags', '+faststart', input],
    { timeout: 15000, maxBuffer: 65536 });
    server.listen(socket); await once(server, 'listening');
    const spool = new MediaSpooler({ directory: dir, maxConcurrent: 1, capacityBytes: 64 * 1024 * 1024 });
    const client = new UnixImageDecoder(socket, spool);
    const result = await client.decodeVideo(createReadStream(input), { kind: 'VIDEO', contentType: 'video/mp4', byteLength: (await stat(input)).size }, AbortSignal.timeout(30000));
    try {
      assert.equal(result.kind, 'VIDEO'); assert.equal(result.video.width, 160); assert.equal(result.video.height, 90);
      assert.ok(result.video.durationMs >= 1000 && result.video.durationMs <= 1100);
      assert.equal((await stat(result.video.file.path)).mode & 0o777, 0o600);
      assert.equal((await stat(result.poster.file.path)).mode & 0o777, 0o600);
      const { stdout } = await exec(binaries.ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', result.video.file.path], { maxBuffer: 32768 });
      const metadata = JSON.parse(stdout);
      assert.deepEqual(metadata.streams.map(stream => stream.codec_name), ['h264', 'aac']);
      assert.equal(metadata.streams[0].pix_fmt, 'yuv420p'); assert.equal(metadata.streams[0].avg_frame_rate, '30/1');
      assert.ok(!stdout.includes('synthetic-private-title'));
      const poster = await sharp(result.poster.file.path).metadata(); assert.equal(poster.format, 'webp');
      assert.equal(poster.width, result.poster.width); assert.equal(poster.height, result.poster.height);
    } finally { await result.video.file.dispose(); await result.poster.file.dispose(); }
    assert.deepEqual(spool.stats(), { activeUploads: 0, reservedBytes: 0 });
    await new Promise(resolve => server.close(resolve));
    assert.deepEqual((await readdir(dir)).sort(), ['input.mp4']);
  });
