import { expect, test } from '@playwright/test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import ts from 'typescript';

// Isolated real codec fixture: generated color + sine, never imported by runtime code.
// This exercises the actual client/resource against synthetic HTTP, not deployed R2.
test('actual H264/AAC decode, validated ranges, seek, lease renewal and revocation', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'rogichat-video-test-'));
  let movie: Buffer; let poster: Buffer;
  try {
    const run = promisify(execFile);
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=navy:s=160x90:r=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-threads', '1', '-c:a', 'aac', '-ac', '2', '-movflags', '+faststart', join(directory, 'video.mp4')]);
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', join(directory, 'video.mp4'), '-frames:v', '1',
      '-c:v', 'libwebp', join(directory, 'poster.webp')]);
    movie = await readFile(join(directory, 'video.mp4')); poster = await readFile(join(directory, 'poster.webp'));
  } finally { await rm(directory, { recursive: true, force: true }); }
  let accesses = 0; const ranges: string[] = [];
  await page.clock.install();
  await page.route('https://video.example.test/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<video controls muted playsinline></video>' });
    const name = path.slice(1);
    if (!['video-client', 'video-resource', 'contracts'].includes(name)) return route.abort();
    const source = await readFile(new URL(`../../src/features/media/${name}.ts`, import.meta.url), 'utf8');
    return route.fulfill({ contentType: 'text/javascript', body: ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
    }).outputText });
  });
  await page.route('https://api.qa.rogi.chat/v1/media/assets/*/access', async route => {
    accesses++;
    const { variant } = route.request().postDataJSON() as { variant: string };
    await route.fulfill({ json: { url: `https://media.example.test/${variant}?lease=${accesses}`, expiresIn: 60 } });
  });
  await page.route('https://media.example.test/**', async route => {
    const request = route.request(); const range = request.headers()['range']!; ranges.push(range);
    expect(request.headers()['cookie']).toBeUndefined(); expect(request.headers()['x-csrf-token']).toBeUndefined();
    const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(range)!;
    const bytes = new URL(request.url()).pathname === '/video' ? movie : poster;
    await route.fulfill({ status: 206, headers: {
      ETag: '"isolated-immutable"', 'Content-Type': bytes === movie ? 'video/mp4' : 'image/webp',
      'Content-Range': `bytes ${start}-${end}/${bytes.length}`, 'Content-Length': String(Number(end) - Number(start) + 1),
      'Access-Control-Allow-Origin': 'https://video.example.test', 'Access-Control-Expose-Headers': 'Content-Range, Content-Length, ETag',
    }, body: bytes.subarray(Number(start), Number(end) + 1) });
  });
  await page.goto('https://video.example.test/');
  await page.evaluate(async () => {
    // Browser imports transpiled production sources through the isolated route above.
    const importer = new Function('url', 'return import(url)') as (url: string) => Promise<Record<string, new (...args: unknown[]) => unknown>>;
    const { VideoClient } = await importer('/video-client');
    const { MediaVideoResource } = await importer('/video-resource');
    const abort = new AbortController(); let used = 0;
    const client = new VideoClient!({ apiOrigin: 'https://api.qa.rogi.chat', storageOrigins: ['https://media.example.test'],
      csrf: () => 'a'.repeat(43), lifetime: { signal: abort.signal, isCurrent: () => true }, verifySession: async () => {},
      budget: { reserve(bytes: number) { used += bytes; if (used > 64 * 1024 * 1024) throw Error('capacity');
        let released = false; return () => { if (!released) { released = true; used -= bytes; } }; } },
    });
    const resource = new MediaVideoResource!(client) as { attach(element: HTMLVideoElement): void; load(asset: string, context: unknown, revision: string, restore?: boolean): Promise<void> };
    resource.attach(document.querySelector('video')!);
    Object.assign(window, { reloadVideo: () => resource.load('11111111-1111-4111-8111-111111111111', { roomId: '22222222-2222-4222-8222-222222222222', messageId: '33333333-3333-4333-8333-333333333333' }, '1', true), revokeVideo: () => abort.abort(), videoBytes: () => used });
    await resource.load('11111111-1111-4111-8111-111111111111', {
      roomId: '22222222-2222-4222-8222-222222222222', messageId: '33333333-3333-4333-8333-333333333333',
    }, '1');
  });
  const video = page.locator('video');
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
  await video.evaluate(async element => { const v = element as HTMLVideoElement; await v.play(); });
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0);
  await video.evaluate(element => { const v = element as HTMLVideoElement; v.pause(); v.currentTime = 1.25; });
  const old = await video.getAttribute('src');
  await page.clock.fastForward(60_001);
  expect(accesses).toBe(2);
  await expect(video).not.toHaveAttribute('src');
  await page.evaluate(() => (window as unknown as { reloadVideo(): Promise<void> }).reloadVideo());
  await expect.poll(() => accesses).toBe(4);
  await expect.poll(() => video.getAttribute('src')).not.toBe(old);
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeCloseTo(1.25, 1);
  expect(ranges.filter(range => range === 'bytes=0-0')).toHaveLength(4);
  await page.evaluate(() => (window as unknown as { revokeVideo(): void }).revokeVideo());
  await expect(video).not.toHaveAttribute('src'); await expect(video).not.toHaveAttribute('poster');
  expect(await page.evaluate(() => (window as unknown as { videoBytes(): number }).videoBytes())).toBe(0);
  expect(await video.evaluate(element => (element as HTMLVideoElement).paused)).toBe(true);
});
