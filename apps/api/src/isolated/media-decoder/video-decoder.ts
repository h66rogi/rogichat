import { constants } from 'node:fs';
import { chmod, mkdir, open, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import sharp from 'sharp';
import { assertMediaSignature, parseMediaIntent } from '../../common/media/media-policy.js';
import type { MediaIntent } from '../../common/media/media-policy.js';
import { parseVideoProbe, VIDEO_PROBE_BYTES } from './video-probe.js';
import { runVideoProcess } from './video-process.js';

export const VIDEO_OUTPUT_BYTES = 50 * 1024 * 1024;
export const VIDEO_POSTER_BYTES = 2 * 1024 * 1024;
export interface VideoBinaries { ffmpeg: string; ffprobe: string }
export interface DecodedVideo {
  video: { path: string; contentType: 'video/mp4'; byteLength: number; width: number; height: number; durationMs: number };
  poster: { path: string; contentType: 'image/webp'; byteLength: number; width: number; height: number };
}
export class VideoDecodeError extends Error {
  constructor(readonly code: 'INVALID_VIDEO' | 'INVALID_VIDEO_PATH' | 'VIDEO_DECODER_BUSY') { super(code); }
}
let busy = false;
// Protocol flags are defense in depth, not a substitute for container network/filesystem isolation.
const inputOptions = ['-protocol_whitelist', 'file', '-format_whitelist', 'mov', '-f', 'mov',
  '-enable_drefs', '0', '-use_absolute_path', '0', '-probesize', '5242880', '-analyzeduration', '5000000'];
const ffmpegOptions = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-xerror', '-max_error_rate', '0',
  '-max_alloc', '67108864', '-filter_threads', '1', '-filter_complex_threads', '1'];
const stripMetadata = ['-map_metadata', '-1', '-map_metadata:s', '-1', '-map_chapters', '-1'];

/** Isolated, per-job decoder child ONLY; never called in the API/worker process.
 * The caller owns an immutable input and exclusive parent scratch directory, and enforces
 * a 128 MiB tmpfs, CPU/memory caps, one conversion and an external process-group hard-kill
 * deadline (killing only the Node child can leave a transcoder orphan).
 * The fresh outputDirectory belongs to this operation: deleted on failure, caller disposes on success.
 * Binary paths are trusted deployment configuration, never request fields.
 */
export async function decodeVideo(inputPath: string, outputDirectory: string, intent: MediaIntent,
  binaries: VideoBinaries = { ffmpeg: '/usr/bin/ffmpeg', ffprobe: '/usr/bin/ffprobe' }, signal?: AbortSignal): Promise<Readonly<DecodedVideo>> {
  if (busy) throw new VideoDecodeError('VIDEO_DECODER_BUSY');
  busy = true;
  let owned = false;
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const deadline = setTimeout(abort, 210_000);
  let monitor: ReturnType<typeof setInterval> | undefined;
  let checking = false;
  try {
    if (![inputPath, outputDirectory, binaries.ffmpeg, binaries.ffprobe].every(value => typeof value === 'string' && isAbsolute(value) && !value.includes('\0')) ||
        resolve(inputPath) === resolve(outputDirectory)) throw new VideoDecodeError('INVALID_VIDEO_PATH');
    const videoPath = join(outputDirectory, 'video.mp4');
    const posterPath = join(outputDirectory, 'poster.webp');
    const checked = parseMediaIntent(intent, { canRegisterStickers: false });
    if (checked.kind !== 'VIDEO' || controller.signal.aborted) throw new VideoDecodeError('INVALID_VIDEO');
    const input = await open(inputPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await input.stat();
      if (!info.isFile() || info.size !== checked.byteLength) throw new VideoDecodeError('INVALID_VIDEO');
      const prefix = Buffer.alloc(Math.min(info.size, 4096));
      const { bytesRead } = await input.read(prefix, 0, prefix.length, 0);
      if (bytesRead !== prefix.length) throw new VideoDecodeError('INVALID_VIDEO');
      assertMediaSignature(checked, prefix);
    } finally { await input.close(); }
    try { await mkdir(outputDirectory, { mode: 0o700 }); owned = true; }
    catch { throw new VideoDecodeError('INVALID_VIDEO_PATH'); }
    monitor = setInterval(() => {
      if (checking) return;
      checking = true;
      void Promise.all([[videoPath, VIDEO_OUTPUT_BYTES], [posterPath, VIDEO_POSTER_BYTES]].map(async ([path, cap]) => {
        try { if ((await stat(path as string)).size > (cap as number)) abort(); }
        catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) abort(); }
      })).finally(() => { checking = false; });
    }, 100);
    const probe = async (path: string, bytes: number, canonical = false) => parseVideoProbe(await runVideoProcess(binaries.ffprobe,
      ['-v', 'error', '-max_alloc', '67108864', ...inputOptions, '-threads', '1', '-show_format', '-show_streams', '-of', 'json', path],
      { timeoutMs: 10_000, stdoutBytes: VIDEO_PROBE_BYTES, signal: controller.signal }), bytes, canonical);
    const source = await probe(inputPath, checked.byteLength);
    // Full source decode; no stream copy and no -t/-shortest that could silently truncate an invalid source.
    await runVideoProcess(binaries.ffmpeg, [...ffmpegOptions, ...inputOptions, '-threads', '1', '-err_detect', 'explode', '-i', inputPath,
      '-map', `0:${source.videoIndex}`, ...(source.audioIndex === null ? ['-an'] : ['-map', `0:${source.audioIndex}`]),
      ...stripMetadata, '-sn', '-dn', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,fps=30',
      '-c:v', 'libx264', '-threads:v', '1', '-preset', 'fast', '-crf', '23', '-maxrate', '5M', '-bufsize', '10M', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-threads:a', '1', '-b:a', '128k', '-ac', '2', '-ar', '48000', '-max_muxing_queue_size', '256',
      '-muxing_queue_data_threshold', '1048576', '-movflags', '+faststart', '-f', 'mp4', videoPath],
    { timeoutMs: 120_000, stdoutBytes: 0, signal: controller.signal });
    const videoStat = await stat(videoPath);
    if (videoStat.size <= 0 || videoStat.size > VIDEO_OUTPUT_BYTES) throw new VideoDecodeError('INVALID_VIDEO');
    const output = await probe(videoPath, videoStat.size, true);
    if (output.codec !== 'h264' || output.rotation !== 0 || Math.abs(output.durationMs - source.durationMs) > 100 ||
        output.width !== source.width - source.width % 2 || output.height !== source.height - source.height % 2 ||
        (output.audioIndex === null) !== (source.audioIndex === null)) throw new VideoDecodeError('INVALID_VIDEO');
    // Verify the entire generated rendition, not only its container metadata.
    await runVideoProcess(binaries.ffmpeg, [...ffmpegOptions, ...inputOptions, '-threads', '1', '-err_detect', 'explode', '-i', videoPath,
      '-map', '0:v:0', '-map', '0:a:0?', '-threads', '1', '-f', 'null', '-'],
    { timeoutMs: 60_000, stdoutBytes: 0, signal: controller.signal });
    await runVideoProcess(binaries.ffmpeg, [...ffmpegOptions, ...inputOptions, '-threads', '1', '-i', videoPath,
      '-map', '0:v:0', '-an', '-sn', '-dn', ...stripMetadata, '-vf', 'scale=640:640:force_original_aspect_ratio=decrease',
      '-frames:v', '1', '-c:v', 'libwebp', '-threads', '1', '-quality', '80', '-f', 'webp', posterPath],
    { timeoutMs: 10_000, stdoutBytes: 0, signal: controller.signal });
    const posterStat = await stat(posterPath);
    if (posterStat.size <= 0 || posterStat.size > VIDEO_POSTER_BYTES || controller.signal.aborted) throw new VideoDecodeError('INVALID_VIDEO');
    const poster = sharp(posterPath, { failOn: 'warning', limitInputPixels: 640 * 640 });
    const metadata = await poster.metadata();
    if (metadata.format !== 'webp' || !metadata.width || !metadata.height || metadata.width > 640 || metadata.height > 640 ||
        (metadata.pages ?? 1) !== 1 || metadata.exif || metadata.xmp || metadata.icc || metadata.iptc) throw new VideoDecodeError('INVALID_VIDEO');
    await poster.stats();
    await Promise.all([chmod(videoPath, 0o600), chmod(posterPath, 0o600)]);
    if (controller.signal.aborted) throw new VideoDecodeError('INVALID_VIDEO');
    return Object.freeze({
      video: Object.freeze({ path: videoPath, contentType: 'video/mp4' as const, byteLength: videoStat.size, width: output.width, height: output.height, durationMs: output.durationMs }),
      poster: Object.freeze({ path: posterPath, contentType: 'image/webp' as const, byteLength: posterStat.size, width: metadata.width, height: metadata.height }),
    });
  } catch (error) {
    if (owned) await rm(outputDirectory, { recursive: true, force: true });
    throw error instanceof VideoDecodeError ? error : new VideoDecodeError('INVALID_VIDEO');
  } finally {
    clearTimeout(deadline);
    if (monitor) clearInterval(monitor);
    signal?.removeEventListener('abort', abort);
    busy = false;
  }
}
