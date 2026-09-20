// Runs in the isolated decoder process graph. Deployment isolation remains an external gate.
import { decodeImage } from './media-image-decoder.js';
import { decodeVideo } from './video-decoder.js';
import { parseMediaIntent } from '../../common/media/media-policy.js';
import { join } from 'node:path';
try {
  if (process.argv.length !== 7) throw new Error();
  const intent = parseMediaIntent(JSON.parse(process.argv[4]!), { canRegisterStickers: true });
  if (intent.kind === 'VIDEO') {
    const result = await decodeVideo(process.argv[2]!, join(process.argv[3]!, 'video'), intent, { ffmpeg: process.argv[5]!, ffprobe: process.argv[6]! });
    const video = { contentType: result.video.contentType, byteLength: result.video.byteLength, width: result.video.width, height: result.video.height, durationMs: result.video.durationMs };
    const poster = { contentType: result.poster.contentType, byteLength: result.poster.byteLength, width: result.poster.width, height: result.poster.height };
    process.stdout.write(JSON.stringify({ version: 1, kind: 'VIDEO', variants: [{ role: 'video', ...video }, { role: 'poster', ...poster }] }));
  } else {
    const result = await decodeImage(process.argv[2]!, join(process.argv[3]!, 'image.webp'), intent);
    process.stdout.write(JSON.stringify({ version: 1, kind: 'IMAGE', variants: [{ role: 'image', ...result }] }));
  }
} catch { process.exitCode = 1; }
