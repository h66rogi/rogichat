// Protected operator-only entry. A consumed DB receipt never opens serving.
import 'reflect-metadata';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { readConfig } from '../../infrastructure/config/config.js';
import { readMediaConfig } from '../media/adapters/media-store.js';
import { readDeletionConfig } from '../deletion/deletion-config.js';
import { readAuthConfig } from '../../infrastructure/config/auth-config.js';
import { RestoreGateModule } from './restore-gate.module.js';
import { RestoreGateService } from './restore-gate.service.js';
import { RestoreProofVerifier, canonical, checkedScope, restoreRejected } from './restore-proof.js';
import { RestoreIsolationClient } from './restore-isolation.client.js';

export function readProtectedRestoreFile(path: string, maximum: number): Buffer {
  let fd: number | undefined;
  try {
    if (!isAbsolute(path) || resolve(path) !== path || realpathSync(path) !== path) return restoreRejected();
    const before = lstatSync(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink()) return restoreRejected();
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const file = fstatSync(fd, { bigint: true });
    if (!file.isFile() || file.nlink !== 1n || file.size < 1n || file.size > BigInt(maximum) || ![0o400n, 0o600n].includes(file.mode & 0o7777n) ||
        ![0n, BigInt(process.geteuid?.() ?? -1)].includes(file.uid) || before.dev !== file.dev || before.ino !== file.ino) return restoreRejected();
    const bytes = Buffer.alloc(maximum + 1); let length = 0, count: number;
    do { count = readSync(fd, bytes, length, bytes.length - length, null); length += count; } while (count > 0 && length < bytes.length);
    const after = fstatSync(fd, { bigint: true }), current = lstatSync(path, { bigint: true });
    const stable = ['dev', 'ino', 'size', 'mode', 'uid', 'nlink', 'mtimeNs', 'ctimeNs'] as const;
    if (BigInt(length) !== file.size || stable.some(field => before[field] !== file[field] || after[field] !== file[field] || current[field] !== file[field])) return restoreRejected();
    return bytes.subarray(0, length);
  } finally { if (fd !== undefined) closeSync(fd); }
}
function json(path: string): unknown { return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readProtectedRestoreFile(path, 3 * 1024 * 1024))) as unknown; }
export async function main() {
  const [verb, ...extra] = process.argv.slice(2);
  if (!verb || !['prepare', 'observe', 'consume'].includes(verb) || extra.length || !process.env.RESTORE_GATE_CONFIG_FILE) restoreRejected();
  const bytes = readProtectedRestoreFile(process.env.RESTORE_GATE_CONFIG_FILE!, 8192), text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
  const input: unknown = JSON.parse(text);
  if (!input || typeof input !== 'object' || Array.isArray(input) || canonical(input) !== text) return restoreRejected();
  const settings = input as Record<string, unknown>;
  if (Object.keys(settings).sort().join(',') !== 'boundaryProofFile,boundaryPublicKeyFile,isolationSocket,releaseProofFile,releasePublicKeyFile,scope' ||
      !['boundaryProofFile', 'boundaryPublicKeyFile', 'isolationSocket', 'releasePublicKeyFile'].every(key => typeof settings[key] === 'string' && (settings[key] as string).startsWith('/')) ||
      (settings.releaseProofFile !== null && (typeof settings.releaseProofFile !== 'string' || !settings.releaseProofFile.startsWith('/')))) return restoreRejected();
  const scope = checkedScope(settings.scope), config = readConfig('worker'), auth = readAuthConfig(config);
  const media = readMediaConfig(config.environment), deletion = readDeletionConfig(config.environment, media);
  if (config.environment !== scope.environment || config.database.name !== scope.targetId || !deletion || !auth.authorizationEpoch) restoreRejected();
  const verifier = new RestoreProofVerifier(readProtectedRestoreFile(settings.boundaryPublicKeyFile as string, 8192), readProtectedRestoreFile(settings.releasePublicKeyFile as string, 8192));
  const boundary = json(settings.boundaryProofFile as string);
  const app = await NestFactory.createApplicationContext(RestoreGateModule.register(DatabaseModule.register({ config }), {
    scope, auth, verifier, isolation: new RestoreIsolationClient(settings.isolationSocket as string, verifier), ledger: { config: deletion! }, media,
  }), { logger: false, abortOnError: false });
  try {
    const gate = app.get(RestoreGateService);
    const report = verb === 'prepare' ? await gate.prepare(boundary) : verb === 'observe' ? await gate.observe(boundary)
      : typeof settings.releaseProofFile === 'string' ? await gate.consume(boundary, json(settings.releaseProofFile)) : restoreRejected();
    process.stdout.write(JSON.stringify(report) + '\n');
    process.exitCode = 'ready' in report && !report.ready ? 2 : 0;
  } finally { await app.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(() => { process.stderr.write('restore_gate_rejected\n'); process.exitCode = 1; });
}
