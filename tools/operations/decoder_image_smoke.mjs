// Fed over stdin into the built image by hosted CI; never copied into a product layer.
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { access, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { frame, parseDecoderResponse } from './dist/common/media/media-decoder-protocol.js';

assert.equal(process.getuid(), 10001);
assert.equal(sharp.versions.sharp, '0.35.4');
assert.match(execFileSync('/usr/bin/ffmpeg', ['-version']).toString(), /ffmpeg version 5\.1\.9/);
assert.match(execFileSync('/usr/bin/ffprobe', ['-version']).toString(), /ffprobe version 5\.1\.9/);
for (const key of Object.keys(process.env)) assert.doesNotMatch(key, /secret|password|token|credential|database|auth|aws_/i);
for (const path of ['/run/rogichat/secrets', '/etc/rogichat', '/var/run/docker.sock', '/app/.git']) {
  await assert.rejects(access(path), { code: 'ENOENT' });
}
await assert.rejects(writeFile('/app/write-probe', 'denied'), { code: 'EROFS' });
assert.equal((await stat('/run/decoder/image.sock')).mode & 0o777, 0o600);
const directory = await mkdtemp('/tmp/image-proof-');

async function request(intent, bytes) {
  const socket = connect('/run/decoder/image.sock');
  const chunks = [];
  let total = 0;
  const deadline = setTimeout(() => socket.destroy(new Error('decoder_timeout')), 60000);
  try {
    await once(socket, 'connect');
    const completed = new Promise((resolve, reject) => {
      socket.on('data', chunk => {
        total += chunk.length;
        if (total > 16 * 1024 * 1024) socket.destroy(new Error('response_limit'));
        else chunks.push(chunk);
      });
      socket.once('end', resolve); socket.once('error', reject);
      socket.once('close', resolve);
    });
    socket.write(frame({ version: 1, intent })); socket.write(bytes);
    await completed;
    const response = Buffer.concat(chunks);
    assert.ok(response.length >= 4);
    const length = response.readUInt32BE();
    assert.ok(length <= 1024);
    const metadata = parseDecoderResponse(JSON.parse(response.subarray(4, 4 + length)), intent);
    let offset = 4 + length;
    const variants = metadata.variants.map(variant => {
      const body = response.subarray(offset, offset + variant.byteLength);
      assert.equal(body.length, variant.byteLength); offset += variant.byteLength;
      return { ...variant, body };
    });
    assert.equal(offset, response.length);
    return variants;
  } finally { clearTimeout(deadline); socket.destroy(); }
}

try {
  for (const [format, contentType] of [['png', 'image/png'], ['jpeg', 'image/jpeg'], ['webp', 'image/webp']]) {
    const bytes = await sharp({ create: { width: 32, height: 16, channels: 3, background: '#2255aa' } })
      .withMetadata().withExifMerge({ IFD0: { Artist: 'isolated-test-metadata' } })[format]().toBuffer();
    const [output] = await request({ kind: 'PHOTO', contentType, byteLength: bytes.length }, bytes);
    assert.equal(output.role, 'image');
    const metadata = await sharp(output.body).metadata();
    assert.equal(metadata.format, 'webp'); assert.equal(metadata.width, 32); assert.equal(metadata.height, 16);
    assert.equal(metadata.exif, undefined); await sharp(output.body).stats();
  }
  const video = `${directory}/source.mp4`;
  execFileSync('/usr/bin/ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin',
    '-f', 'lavfi', '-i', 'color=c=navy:s=160x90:r=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '1', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '2',
    '-movflags', '+faststart', video]);
  const bytes = await readFile(video);
  const variants = await request({ kind: 'VIDEO', contentType: 'video/mp4', byteLength: bytes.length }, bytes);
  assert.deepEqual(variants.map(v => v.role), ['video', 'poster']);
  const output = `${directory}/received.mp4`;
  await writeFile(output, variants[0].body);
  const probe = JSON.parse(execFileSync('/usr/bin/ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', output]));
  assert.equal(probe.streams.find(s => s.codec_type === 'video').codec_name, 'h264');
  assert.equal(probe.streams.find(s => s.codec_type === 'audio').codec_name, 'aac');
  execFileSync('/usr/bin/ffmpeg', ['-v', 'error', '-i', output, '-f', 'null', '-']);
  assert.equal((await sharp(variants[1].body).metadata()).format, 'webp');
  await sharp(variants[1].body).stats();
  await assert.rejects(request({ kind: 'PHOTO', contentType: 'image/png', byteLength: 16 }, Buffer.alloc(16)));
  // The server removes job scratch asynchronously immediately after closing IPC.
  for (let attempt = 0; attempt < 50; attempt++) {
    if ((await readdir('/tmp')).every(name => name === directory.split('/').at(-1))) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.deepEqual(await readdir('/tmp'), [directory.split('/').at(-1)]);
  console.log('Real decoder IPC: PNG/JPEG/WebP, H264+AAC video and WebP poster, metadata stripping, invalid input rejection, scratch cleanup passed.');
} finally { await rm(directory, { recursive: true, force: true }); }
