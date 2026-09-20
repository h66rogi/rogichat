#!/usr/bin/env node
/**
 * Verifies that synthetic preview screens exist only in the QA web build.
 *
 * Usage: node tools/web/check-preview-isolation.mjs [--shape production|qa|both]
 *
 * For each shape it inspects the built output under apps/web (`.next` for production, `.next-qa` for QA):
 *   1. route manifests: `/preview*` routes must be absent (production) or present (QA);
 *   2. every file under server/, static/ and standalone/ is scanned for the fixture marker and for
 *      `.preview.tsx` module names: none in production, at least one in QA;
 *   3. the standalone tree never contains a build cache or a `src/preview` source copy;
 *   4. the standalone server is started on a free port and probed over HTTP: `/` is 200, `/preview` and
 *      `/preview/chat/fan` are 404 (production) or 200 (QA), `/sw.js` is JavaScript with a revalidating
 *      cache policy, `/manifest.webmanifest` is served, and `/auth/login` redirects to `/login` with an
 *      enumerated reason only.
 * Any failure exits non-zero. Builds are not started here; run `pnpm web:build` / `pnpm web:build:qa` first.
 */
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB = path.join(ROOT, 'apps', 'web');
const MARKER = 'rogichat-preview-fixture-7f415df1';
const PREVIEW_MODULE = '.preview.tsx';

const SHAPES = {
  production: { distDir: '.next', expectPreview: false },
  qa: { distDir: '.next-qa', expectPreview: true },
};

function parseShape(argv) {
  const index = argv.indexOf('--shape');
  const value = index >= 0 ? argv[index + 1] : 'both';
  if (value === 'both') return ['production', 'qa'];
  if (value in SHAPES) return [value];
  throw new Error(`Unknown shape ${value}; expected production, qa or both`);
}

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

async function scanForStrings(dir, needles) {
  const hits = new Map(needles.map((needle) => [needle, []]));
  for await (const file of walk(dir)) {
    const content = await readFile(file);
    for (const needle of needles) {
      if (content.includes(needle)) hits.get(needle).push(path.relative(WEB, file));
    }
  }
  return hits;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function withStandaloneServer(shape, fn) {
  const { distDir } = SHAPES[shape];
  const standaloneRoot = path.join(WEB, distDir, 'standalone');
  const temp = await mkdtemp(path.join(tmpdir(), `rogichat-web-${shape}-`));
  try {
    // Replicate the image layout: standalone tree + static assets + public files.
    await cp(standaloneRoot, temp, { recursive: true });
    await cp(path.join(WEB, distDir, 'static'), path.join(temp, 'apps', 'web', distDir, 'static'), { recursive: true });
    await cp(path.join(WEB, 'public'), path.join(temp, 'apps', 'web', 'public'), { recursive: true });
    const port = await freePort();
    const child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(temp, 'apps', 'web'),
      env: { ...process.env, PORT: String(port), HOSTNAME: '127.0.0.1', NODE_ENV: 'production' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    // Registered immediately so an early exit is never missed by the shutdown below.
    const exited = new Promise((resolve) => child.once('exit', resolve));
    const base = `http://127.0.0.1:${port}`;
    try {
      await waitForServer(base, child);
      await fn(base);
    } catch (error) {
      error.message += `\nserver output:\n${output}`;
      throw error;
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        const timeout = new Promise((resolve) => setTimeout(resolve, 5000, 'timeout'));
        if ((await Promise.race([exited, timeout])) === 'timeout') child.kill('SIGKILL');
      }
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function waitForServer(base, child) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`standalone server exited early with ${child.exitCode}`);
    try {
      const response = await fetch(`${base}/`, { redirect: 'manual', signal: AbortSignal.timeout(2000) });
      if (response.status > 0) return;
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('standalone server did not start within 20s');
}

function assert(condition, message, failures) {
  if (!condition) failures.push(message);
}

async function checkShape(shape) {
  const { distDir, expectPreview } = SHAPES[shape];
  const dist = path.join(WEB, distDir);
  const failures = [];
  await stat(dist).catch(() => {
    throw new Error(`${shape}: build output ${path.relative(ROOT, dist)} is missing; build it first`);
  });

  const appRoutes = await readJson(path.join(dist, 'app-path-routes-manifest.json'));
  const previewRoutes = Object.keys(appRoutes).filter((route) => route.includes('/preview'));
  if (expectPreview) {
    assert(previewRoutes.length >= 4, `${shape}: expected preview routes in app-path-routes-manifest, found ${previewRoutes.length}`, failures);
  } else {
    assert(previewRoutes.length === 0, `${shape}: preview routes present in app-path-routes-manifest: ${previewRoutes.join(', ')}`, failures);
  }
  const routesManifest = await readFile(path.join(dist, 'routes-manifest.json'), 'utf8');
  assert(expectPreview || !routesManifest.includes('/preview'), `${shape}: routes-manifest mentions /preview`, failures);
  const prerender = await readFile(path.join(dist, 'prerender-manifest.json'), 'utf8').catch(() => '');
  assert(expectPreview || !prerender.includes('/preview'), `${shape}: prerender-manifest mentions /preview`, failures);

  for (const sub of ['server', 'static', 'standalone']) {
    const hits = await scanForStrings(path.join(dist, sub), [MARKER, PREVIEW_MODULE]);
    for (const [needle, files] of hits) {
      if (expectPreview) {
        if (sub === 'server' && needle === MARKER) assert(files.length > 0, `${shape}: fixture marker missing from ${sub}`, failures);
      } else {
        assert(files.length === 0, `${shape}: "${needle}" found in ${sub}: ${files.slice(0, 5).join(', ')}`, failures);
      }
    }
  }

  for await (const file of walk(path.join(dist, 'standalone'))) {
    const relative = path.relative(dist, file);
    assert(!relative.includes(`${distDir}${path.sep}cache${path.sep}`), `${shape}: build cache inside standalone: ${relative}`, failures);
    assert(!relative.includes(`src${path.sep}preview`), `${shape}: preview source copied into standalone: ${relative}`, failures);
    // Next's own preview-mode runtime lives under node_modules; only app artifacts are checked by name.
    const isAppArtifact = !relative.split(path.sep).includes('node_modules');
    assert(expectPreview || !isAppArtifact || !relative.includes('preview'), `${shape}: preview artifact inside standalone: ${relative}`, failures);
  }

  await withStandaloneServer(shape, async (base) => {
    const get = (route) => fetch(`${base}${route}`, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    const home = await get('/');
    assert(home.status === 200, `${shape}: GET / returned ${home.status}`, failures);
    for (const route of ['/preview', '/preview/chat/fan', '/preview/chat/streamer', '/preview/settings']) {
      const response = await get(route);
      const expected = expectPreview ? 200 : 404;
      assert(response.status === expected, `${shape}: GET ${route} returned ${response.status}, expected ${expected}`, failures);
      const body = await response.text();
      assert(expectPreview || !body.includes(MARKER), `${shape}: GET ${route} body contains fixture marker`, failures);
    }
    const sw = await get('/sw.js');
    assert(sw.status === 200, `${shape}: GET /sw.js returned ${sw.status}`, failures);
    assert((sw.headers.get('content-type') ?? '').includes('javascript'), `${shape}: /sw.js content-type ${sw.headers.get('content-type')}`, failures);
    assert(/no-cache|no-store|must-revalidate/.test(sw.headers.get('cache-control') ?? ''), `${shape}: /sw.js cache-control ${sw.headers.get('cache-control')}`, failures);
    const manifest = await get('/manifest.webmanifest');
    assert(manifest.status === 200, `${shape}: GET /manifest.webmanifest returned ${manifest.status}`, failures);
    const legacy = await get('/auth/login?error=access_denied&code=SECRET-QUERY-VALUE&state=abc');
    assert(legacy.status === 303, `${shape}: GET /auth/login returned ${legacy.status}`, failures);
    const location = legacy.headers.get('location') ?? '';
    assert(location.endsWith('/login?reason=cancelled'), `${shape}: /auth/login redirected to ${location}`, failures);
    assert(!location.includes('SECRET-QUERY-VALUE'), `${shape}: raw query copied into redirect`, failures);
    const robots = home.headers.get('x-robots-tag');
    assert(expectPreview ? robots === 'noindex, nofollow' : robots === null, `${shape}: x-robots-tag is ${robots}`, failures);
  });

  return failures;
}

const shapes = parseShape(process.argv.slice(2));
let failed = false;
for (const shape of shapes) {
  const failures = await checkShape(shape);
  if (failures.length) {
    failed = true;
    console.error(`[${shape}] preview isolation FAILED`);
    for (const failure of failures) console.error(`  - ${failure}`);
  } else {
    console.log(`[${shape}] preview isolation OK`);
  }
}
process.exit(failed ? 1 : 0);
