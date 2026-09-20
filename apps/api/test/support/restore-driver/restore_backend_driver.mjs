#!/usr/bin/env node
/** Source/compiled-artifact pinned driver for the actual backend restore module.
 * Only the existing disposable MySQL lane is supported. No live CLI fallback.
 */
import { createHash, createPrivateKey, createPublicKey, randomBytes, sign } from 'node:crypto';
import { constants } from 'node:fs';
import { cp, lstat, mkdtemp, open, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonical, checkProof, checkReleasePair } from './restore_proof.mjs';
import { validateMediaConfig, createFixtureMediaStore } from './restore_fixture_media.mjs';

const fail = () => { throw new Error('isolated_restore_rejected'); };
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const keys = ['version', 'sourceRoot', 'sourceCommit', 'distSha256', 'scope', 'boundaryProofFile',
  'boundaryPublicKeyFile', 'releaseProofFile', 'releasePublicKeyFile', 'replayLedgerFile',
  'isolationSocket', 'authSecretFile', 'authorizationEpochFile', 'media'];

async function protectedRead(path, maximum = 3 * 1024 * 1024) {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink()) fail();
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.dev !== before.dev || info.ino !== before.ino
        || ![0o400, 0o600].includes(info.mode & 0o7777) || ![0, process.getuid?.()].includes(info.uid)
        || info.size < 1 || info.size > maximum) fail();
    const bytes = await file.readFile();
    if (bytes.length !== info.size) fail();
    return bytes;
  } finally { await file.close(); }
}

export function validateIsolatedConfig(value, env = process.env) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== [...keys].sort().join(',') || value.version !== 1
      || !/^[a-f0-9]{40}$/.test(value.sourceCommit) || !sha(value.distSha256)
      || value.scope?.sourceCommit !== value.sourceCommit || value.scope?.environment !== 'qa'
      || env.ROGICHAT_TEST_MYSQL !== 'disposable' || env.APP_ENV !== 'test' || env.NODE_ENV !== 'test'
      || env.DB_TLS_MODE !== 'disabled' || env.DATABASE_SECRET_FILE) fail();
  for (const key of ['sourceRoot', 'boundaryProofFile', 'boundaryPublicKeyFile', 'releasePublicKeyFile',
    'replayLedgerFile', 'isolationSocket', 'authSecretFile', 'authorizationEpochFile']) {
    if (typeof value[key] !== 'string' || !isAbsolute(value[key])) fail();
  }
  if (value.releaseProofFile !== null && (typeof value.releaseProofFile !== 'string' || !isAbsolute(value.releaseProofFile))) fail();
  let database;
  try { database = new URL(env.DATABASE_URL); } catch { fail(); }
  const suffix = /^\/rogichat_test_([a-f0-9]{16})$/.exec(database.pathname)?.[1];
  if (!suffix || database.protocol !== 'mysql:' || database.hostname !== '127.0.0.1' || !database.port
      || decodeURIComponent(database.username) !== `fixture_${suffix}` || !database.password || database.search || database.hash
      || value.scope.targetId !== database.pathname.slice(1)) fail();
  validateMediaConfig(value.media);
  return value;
}

/** Hash complete compiled tree, with path framing and no symlinks/omissions. */
export async function compiledTreeHash(root) {
  const records = []; let total = 0;
  async function walk(directory) {
    if (!(await lstat(directory)).isDirectory() || (await lstat(directory)).isSymbolicLink()) fail();
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name), info = await lstat(path);
      if (info.isSymbolicLink()) fail();
      if (info.isDirectory()) await walk(path);
      else {
        if (!info.isFile() || info.size > 16 * 1024 * 1024 || records.length >= 10000) fail();
        const bytes = await readFile(path); total += bytes.length;
        if (bytes.length !== info.size || total > 256 * 1024 * 1024) fail();
        records.push({ path: relative(root, path).split('\\').join('/'), sha256: hash(bytes) });
      }
    }
  }
  await walk(root);
  return hash(Buffer.from(canonical(records)));
}

class ReadOnlyFixtureLedger {
  constructor(path, sourceId) { this.path = path; this.sourceId = sourceId; }
  async records() {
    const rows = JSON.parse(await protectedRead(this.path));
    if (!Array.isArray(rows) || rows.length > 10000) fail();
    const map = new Map();
    for (const row of rows) {
      if (!row || Object.keys(row).sort().join(',') !== 'canonicalBase64,key' || typeof row.key !== 'string'
          || typeof row.canonicalBase64 !== 'string' || map.has(row.key)) fail();
      const bytes = Buffer.from(row.canonicalBase64, 'base64');
      if (!bytes.length || bytes.length > 4096 || bytes.toString('base64') !== row.canonicalBase64) fail();
      map.set(row.key, bytes);
    }
    return map;
  }
  async read(key, signal) { signal?.throwIfAborted(); return (await this.records()).get(key) ?? null; }
  async list(cursor, limit, signal) {
    signal?.throwIfAborted();
    const records = await this.records(), names = [...records.keys()].sort();
    if (cursor !== null && (typeof cursor !== 'string' || !/^\d+$/.test(cursor))) fail();
    const offset = cursor === null ? 0 : Number(cursor);
    if (!Number.isSafeInteger(offset) || offset > names.length || !Number.isSafeInteger(limit) || limit < 1) fail();
    const keys = names.slice(offset, offset + limit), end = offset + keys.length;
    return { keys, sizes: keys.map(key => records.get(key).length), cursor: end < names.length ? String(end) : null };
  }
  async putIfAbsent() { fail(); }
  close() {}
}

export async function executeIsolated(verb, config, env = process.env, verifierPrivateKeyFile = null) {
  const input = validateIsolatedConfig(config, env);
  if (!['prepare', 'observe', 'attest', 'consume', 'recover'].includes(verb)
      || (['attest', 'consume', 'recover'].includes(verb) && !input.releaseProofFile)
      || (verb === 'attest' && (typeof verifierPrivateKeyFile !== 'string' || !isAbsolute(verifierPrivateKeyFile)))) fail();
  const sourceRoot = await realpath(input.sourceRoot);
  const git = args => execFileSync('git', ['-C', sourceRoot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (git(['rev-parse', 'HEAD']) !== input.sourceCommit || await realpath(git(['rev-parse', '--show-toplevel'])) !== sourceRoot
      || git(['status', '--porcelain', '--untracked-files=all'])) fail();
  const boundary = JSON.parse(await protectedRead(input.boundaryProofFile));
  const authorityKey = await protectedRead(input.boundaryPublicKeyFile, 8192);
  const verifierKey = await protectedRead(input.releasePublicKeyFile, 8192);
  checkProof(boundary, authorityKey, { ...input.scope, purpose: 'restore-ledger-boundary' });
  // Freeze the validated compiled bytes before import; concurrent source rebuilds
  // cannot replace checked modules between hashing and execution.
  const directory = await mkdtemp(join(tmpdir(), 'rogi-restore-code-'));
  let app;
  try {
    const dist = join(directory, 'dist');
    if (await compiledTreeHash(join(sourceRoot, 'apps/api/dist')) !== input.distSha256) fail();
    await cp(join(sourceRoot, 'apps/api/dist'), dist, { recursive: true, dereference: false });
    if (await compiledTreeHash(dist) !== input.distSha256) fail();
    await writeFile(join(directory, 'package.json'), '{"type":"module"}', { mode: 0o600 });
    await symlink(join(sourceRoot, 'apps/api/node_modules'), join(directory, 'node_modules'));
    const require = createRequire(join(sourceRoot, 'apps/api/package.json'));
    require('reflect-metadata');
    const { NestFactory } = require('@nestjs/core');
    const load = file => import(pathToFileURL(join(dist, file)).href);
    const { readConfig } = await load('infrastructure/config/config.js');
    const { readAuthConfig } = await load('infrastructure/config/auth-config.js');
    const { DatabaseModule } = await load('infrastructure/database/database.module.js');
    const { DeletionLedger } = await load('modules/deletion/deletion-ledger.js');
    const { RestoreGateModule } = await load('modules/restore-gate/restore-gate.module.js');
    const { RestoreGateService } = await load('modules/restore-gate/restore-gate.service.js');
    const { RestoreProofVerifier } = await load('modules/restore-gate/restore-proof.js');
    const { RestoreIsolationClient } = await load('modules/restore-gate/restore-isolation.client.js');
    const isolatedEnv = { APP_ENV: 'test', NODE_ENV: 'test', DB_TLS_MODE: 'disabled', DATABASE_URL: env.DATABASE_URL,
      AUTH_SECRET_FILE: input.authSecretFile, AUTHORIZATION_EPOCH_FILE: input.authorizationEpochFile };
    const runtime = readConfig('worker', isolatedEnv), auth = readAuthConfig(runtime, isolatedEnv);
    const verifier = new RestoreProofVerifier(authorityKey, verifierKey);
    const ledger = new DeletionLedger(new ReadOnlyFixtureLedger(input.replayLedgerFile, input.scope.ledgerSourceId), input.scope.environment);
    app = await NestFactory.createApplicationContext(RestoreGateModule.register(DatabaseModule.register({ config: runtime }), {
      media: { store: await createFixtureMediaStore(input.media) },
      scope: input.scope, auth, verifier, isolation: new RestoreIsolationClient(input.isolationSocket, verifier), ledger: { ledger },
    }), { logger: false, abortOnError: false });
    const gate = app.get(RestoreGateService);
    if (verb === 'prepare') return await gate.prepare(boundary);
    if (verb === 'observe') return await gate.observe(boundary);
    if (verb === 'attest') {
      // This is a fresh direct backend read in this verifier invocation, not an
      // operator-supplied report or a previous stage's claimed success.
      const report = await gate.observe(boundary);
      if (report.ready !== true || report.servingAuthorized !== false || report.releaseReceiptSha256 !== null
          || canonical(report.scope) !== canonical(input.scope)) fail();
      const { observationSha256, ...observed } = report;
      delete observed.ready; delete observed.servingAuthorized; delete observed.releaseReceiptSha256;
      if (!sha(observationSha256) || hash(Buffer.from(canonical(observed))) !== observationSha256) fail();
      const checkedBoundary = checkProof(boundary, authorityKey, { ...input.scope, purpose: 'restore-ledger-boundary' });
      if (observed.boundarySha256 !== checkedBoundary.payloadSha256) fail();
      const privateKey = createPrivateKey(await protectedRead(verifierPrivateKeyFile, 8192));
      if (privateKey.asymmetricKeyType !== 'ed25519') fail();
      const now = Math.floor(Date.now() / 1000);
      const payload = { version: 1, ...input.scope, purpose: 'restore-release', issuedAt: now, expiresAt: now + 120,
        boundarySha256: checkedBoundary.payloadSha256, observationSha256, nonce: randomBytes(16).toString('hex') };
      const bytes = Buffer.from(canonical(payload));
      const envelope = { payloadBase64: bytes.toString('base64'), signatureBase64: sign(null, bytes, privateKey).toString('base64'),
        keyId: hash(createPublicKey(privateKey).export({ type: 'spki', format: 'der' })) };
      checkReleasePair(boundary, envelope, authorityKey, verifierKey, input.scope, observationSha256);
      const parent = await realpath(dirname(input.releaseProofFile));
      const ownRepo = await realpath(join(dirname(fileURLToPath(import.meta.url)), '..'));
      for (const repo of [sourceRoot, ownRepo]) {
        const rel = relative(repo, parent);
        if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) fail();
      }
      const mode = await lstat(parent);
      if (!mode.isDirectory() || (mode.mode & 0o7777) !== 0o700 || ![0, process.getuid?.()].includes(mode.uid)) fail();
      await writeFile(input.releaseProofFile, canonical(envelope), { flag: 'wx', mode: 0o600 });
      return { attested: true, observationSha256, releaseProofSha256: hash(bytes), servingAuthorized: false };
    }
    // Separate direct observation immediately before consuming; the backend still
    // independently checks exact state and single-use nonce in its own transaction.
    const observation = await gate.observe(boundary);
    if (!observation.ready || observation.servingAuthorized !== false) fail();
    const release = JSON.parse(await protectedRead(input.releaseProofFile));
    const pair = checkReleasePair(boundary, release, authorityKey, verifierKey, input.scope, observation.observationSha256);
    if (verb === 'recover') {
      if (observation.releaseReceiptSha256 !== pair.release.payloadSha256) fail();
      return { phase: 'RELEASE_AUTHORIZED', receiptSha256: pair.release.payloadSha256, recovered: true, servingAuthorized: false };
    }
    return await gate.consume(boundary, release);
  } finally {
    try { await app?.close(); } finally { await rm(directory, { recursive: true, force: true }); }
  }
}

async function main() {
  const [verb, configFile, privateKeyFile, ...extra] = process.argv.slice(2);
  if (!verb || !configFile || !isAbsolute(configFile) || extra.length
      || (verb === 'attest' ? !privateKeyFile : privateKeyFile !== undefined)) fail();
  const text = new globalThis.TextDecoder('utf-8', { fatal: true }).decode(await protectedRead(configFile, 16384)).trim();
  const config = JSON.parse(text);
  if (canonical(config) !== text) fail();
  const result = await executeIsolated(verb, config, process.env, privateKeyFile);
  process.stdout.write(JSON.stringify(result) + '\n');
  if ('ready' in result && result.ready !== true) process.exitCode = 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(() => { process.stderr.write('isolated_restore_rejected\n'); process.exitCode = 1; });
}
