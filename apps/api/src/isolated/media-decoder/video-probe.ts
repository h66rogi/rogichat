/** Private ffprobe output boundary. Metadata admission is NOT a full decode or READY proof.
 * The caller must bound subprocess stdout before buffering, enforce a hard deadline and
 * run inside the credential-free, network-none decoder sandbox. Never accept client JSON.
 * ffprobe output fields: https://ffmpeg.org/ffprobe.html#Main-options
 */
export const VIDEO_PROBE_BYTES = 32 * 1024;
export interface VideoProbe {
  videoIndex: number;
  audioIndex: number | null;
  width: number;
  height: number;
  durationMs: number;
  rotation: number;
  codec: string;
}
export class VideoProbeError extends Error {
  constructor() { super('INVALID_VIDEO'); }
}
function invalid(): never { throw new VideoProbeError(); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) return invalid();
  return value;
}
function decimal(value: unknown, min: number, max: number): number {
  if (typeof value !== 'string' || value.length > 32 || !/^-?\d+(?:\.\d+)?$/.test(value)) return invalid();
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return invalid();
  return parsed;
}
function ratio(value: unknown, separator: string): number {
  if (typeof value !== 'string' || value.length > 32) return invalid();
  const parts = value.split(separator);
  if (parts.length !== 2) return invalid();
  return decimal(parts[0], 1, 1_000_000) / decimal(parts[1], 1, 1_000_000);
}
const videoCodecs = new Set(['h264', 'hevc', 'av1', 'vp9', 'mpeg4']);
const audioCodecs = new Set(['aac', 'mp3', 'alac', 'opus', 'pcm_s16le', 'pcm_s24le']);

export function parseVideoProbe(bytes: Buffer, expectedBytes: number, canonical = false): Readonly<VideoProbe> {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > VIDEO_PROBE_BYTES ||
        !Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > 50 * 1024 * 1024) return invalid();
    const root = record(JSON.parse(bytes.toString('utf8')));
    if (root.error !== undefined || !Array.isArray(root.streams) || root.streams.length === 0 || root.streams.length > 4) return invalid();
    const format = record(root.format);
    // Force the MOV demuxer when probing. The combined name is FFmpeg's canonical family name.
    if (format.format_name !== 'mov,mp4,m4a,3gp,3g2,mj2' ||
        decimal(format.size, 1, 50 * 1024 * 1024) !== expectedBytes) return invalid();
    const formatDuration = decimal(format.duration, 0.001, 60);
    if (format.start_time !== undefined) decimal(format.start_time, 0, 1);
    let video: Record<string, unknown> | undefined;
    let audioIndex: number | null = null;
    let duration = formatDuration;
    const indices = new Set<number>();
    for (const value of root.streams) {
      const stream = record(value);
      const index = integer(stream.index, 0, 1023);
      if (indices.has(index)) return invalid();
      indices.add(index);
      if (stream.codec_type === 'data') continue; // Never map metadata/data tracks to output.
      if (stream.codec_type !== 'video' && stream.codec_type !== 'audio') return invalid();
      const streamDuration = decimal(stream.duration, 0.001, 60);
      const start = stream.start_time === undefined ? 0 : decimal(stream.start_time, 0, 1);
      if (start + streamDuration > 60) return invalid();
      duration = Math.max(duration, start + streamDuration);
      if (stream.codec_type === 'video') {
        if (video || typeof stream.codec_name !== 'string' || !videoCodecs.has(stream.codec_name)) return invalid();
        const disposition = record(stream.disposition);
        if (disposition.attached_pic !== 0 || (disposition.timed_thumbnails !== undefined && disposition.timed_thumbnails !== 0)) return invalid();
        const fps = ratio(stream.avg_frame_rate, '/');
        if (fps < 1 || fps > 60 || ratio(stream.r_frame_rate, '/') > 120) return invalid();
        if (canonical && (stream.codec_name !== 'h264' || stream.pix_fmt !== 'yuv420p' || fps !== 30)) return invalid();
        // MVP accepts square-pixel sources only; arbitrary SAR must not expand display dimensions.
        if (stream.sample_aspect_ratio !== undefined && ratio(stream.sample_aspect_ratio, ':') !== 1) return invalid();
        video = stream;
      } else {
        if (audioIndex !== null || typeof stream.codec_name !== 'string' || !audioCodecs.has(stream.codec_name)) return invalid();
        integer(stream.channels, 1, 8);
        decimal(stream.sample_rate, 8000, 96000);
        if (canonical && (stream.codec_name !== 'aac' || stream.channels !== 2 || stream.sample_rate !== '48000')) return invalid();
        audioIndex = index;
      }
    }
    if (!video) return invalid();
    let width = integer(video.width, 2, 1920);
    let height = integer(video.height, 2, 1920);
    if (Math.min(width, height) > 1080) return invalid();
    let rotation = 0;
    if (video.side_data_list !== undefined) {
      if (!Array.isArray(video.side_data_list) || video.side_data_list.length > 8) return invalid();
      let seenRotation = false;
      for (const value of video.side_data_list) {
        const side = record(value);
        if (side.side_data_type !== 'Display Matrix') continue;
        if (seenRotation) return invalid();
        seenRotation = true;
        rotation = integer(side.rotation, -360, 360);
        if (rotation % 90 !== 0) return invalid();
      }
    }
    rotation = ((rotation % 360) + 360) % 360;
    if (canonical && rotation !== 0) return invalid();
    if (rotation === 90 || rotation === 270) [width, height] = [height, width];
    return Object.freeze({ videoIndex: video.index as number, audioIndex, width, height,
      durationMs: Math.ceil(duration * 1000), rotation, codec: video.codec_name as string });
  } catch { throw new VideoProbeError(); }
}
