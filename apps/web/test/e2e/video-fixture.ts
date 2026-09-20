/** Generated codec bytes exist only in isolated tests and temporary files. */
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export async function codecFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'rogichat-video-journey-'));
  try {
    const run = promisify(execFile);
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=navy:s=160x90:r=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-threads', '1', '-c:a', 'aac', '-ac', '2', '-movflags', '+faststart', join(directory, 'video.mp4')]);
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', join(directory, 'video.mp4'), '-frames:v', '1', '-c:v', 'libwebp', join(directory, 'poster.webp')]);
    return { movie: await readFile(join(directory, 'video.mp4')), poster: await readFile(join(directory, 'poster.webp')) };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
