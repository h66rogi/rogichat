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
    if (!file.isFile() || file.nlink !== 1 || file.size < 1 || file.size > 4096 || ![0o400, 0o600].includes(file.mode & 0o7777) ||
        ![0, process.getuid?.()].includes(file.uid) || before.dev !== file.dev || before.ino !== file.ino) throw new Error();
    const bytes = Buffer.alloc(4097);
    let length = 0, read = 0;
    do { read = readSync(fd, bytes, length, bytes.length - length, null); length += read; } while (read > 0 && length < bytes.length);
    if (length !== file.size || length > 4096) throw new Error();
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
    JSON.parse(text); // Also enforce JSON whitespace/escape grammar; token inspection below detects duplicates.
    // Parse exactly five flat string pairs. Keys must be literal canonical tokens;
    // JSON.parse alone would normalize duplicate/escaped aliases before inspection.
    const start = /^\s*\{/.exec(text);
    if (!start) throw new Error();
    let cursor = start[0].length;
    const pair = /\s*"(accessKeyId|accountId|bucket|environment|secretAccessKey)"\s*:\s*("(?:[^"\\]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*")\s*/y;
    const v: Record<string, string> = {};
    for (let index = 0; index < 5; index++) {
      pair.lastIndex = cursor;
      const match = pair.exec(text);
      if (!match || Object.hasOwn(v, match[1]!)) throw new Error();
      v[match[1]!] = JSON.parse(match[2]!) as string;
      cursor = pair.lastIndex;
      if (index < 4) { if (text[cursor++] !== ',') throw new Error(); }
      else if (text[cursor] !== '}' || text.slice(cursor + 1).trim() !== '') throw new Error();
    }
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
