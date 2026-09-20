import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { ConfigurationError } from '../../infrastructure/config/config.js';
import type { MediaConfig } from '../media/adapters/media-store.js';
import type { DeletionLedgerConfig } from './adapters/r2-deletion-ledger.js';

/** File-only admission. Infrastructure must still prove retention and actual credential scope. */
export function readDeletionConfig(environment: string, media: MediaConfig | undefined, env: NodeJS.ProcessEnv = process.env): DeletionLedgerConfig | undefined {
  if (env.DELETION_LEDGER_SECRET_FILE === undefined) return undefined;
  let fd: number | undefined;
  try {
    if (!env.DELETION_LEDGER_SECRET_FILE || !['qa', 'production'].includes(environment) || !media) throw new Error();
    const before = lstatSync(env.DELETION_LEDGER_SECRET_FILE);
    if (!before.isFile() || before.isSymbolicLink()) throw new Error();
    fd = openSync(env.DELETION_LEDGER_SECRET_FILE, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const file = fstatSync(fd);
    if (!file.isFile() || file.nlink !== 1 || file.size < 1 || file.size > 4096 || (file.mode & 0o077) !== 0 ||
        ![0, process.getuid?.()].includes(file.uid) || before.dev !== file.dev || before.ino !== file.ino) throw new Error();
    const bytes = Buffer.alloc(4097);
    let length = 0, read = 0;
    do { read = readSync(fd, bytes, length, bytes.length - length, null); length += read; } while (read > 0 && length < bytes.length);
    if (length !== file.size || length > 4096) throw new Error();
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
    // Flat, fixed ASCII keys: reject duplicates and escaped-key aliases before JSON normalization.
    if ((text.match(/"(?:accessKeyId|accountId|bucket|environment|secretAccessKey)"\s*:/g) ?? []).length !== 5) throw new Error();
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const v = value as Record<string, unknown>;
    if (Object.keys(v).sort().join(',') !== 'accessKeyId,accountId,bucket,environment,secretAccessKey' ||
        v.environment !== environment || typeof v.accountId !== 'string' || !/^[a-f0-9]{32}$/.test(v.accountId) || v.accountId !== media.accountId ||
        typeof v.bucket !== 'string' || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(v.bucket) || v.bucket === media.bucket ||
        typeof v.accessKeyId !== 'string' || !/^[A-Za-z0-9]{20,128}$/.test(v.accessKeyId) || v.accessKeyId === media.accessKeyId ||
        typeof v.secretAccessKey !== 'string' || !/^[A-Za-z0-9/+=]{32,128}$/.test(v.secretAccessKey) || v.secretAccessKey === media.secretAccessKey) throw new Error();
    return Object.freeze({ accountId: v.accountId, bucket: v.bucket, accessKeyId: v.accessKeyId, secretAccessKey: v.secretAccessKey,
      environment: environment as 'qa' | 'production', mediaBucket: media.bucket });
  } catch { throw new ConfigurationError('DELETION_LEDGER_SECRET_FILE'); }
  finally { if (fd !== undefined) closeSync(fd); }
}
