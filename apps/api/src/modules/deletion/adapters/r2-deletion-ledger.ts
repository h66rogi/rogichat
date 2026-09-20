import { createHash } from 'node:crypto';
import { Agent } from 'node:https';
import { Readable } from 'node:stream';
import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { DeletionLedgerError, LEDGER_MAX_BYTES, decodeDeletionIntent, deletionIntentKey } from '../deletion-ledger.js';
import type { DeletionLedgerStore, LedgerEnvironment } from '../deletion-ledger.js';

export interface DeletionLedgerConfig {
  readonly accountId: string; readonly bucket: string; readonly accessKeyId: string; readonly secretAccessKey: string;
  readonly environment: LedgerEnvironment;
  /** Reviewed media bucket binding, used to refuse reuse of the media bucket. */
  readonly mediaBucket: string;
}
export class R2DeletionLedgerStore implements DeletionLedgerStore {
  readonly sourceId: string;
  private readonly client: S3Client;
  private readonly config: DeletionLedgerConfig;
  constructor(config: DeletionLedgerConfig) {
    if (!Object.values(config).every(value => typeof value === 'string') || !/^[a-f0-9]{32}$/.test(config.accountId) ||
        ![config.bucket, config.mediaBucket].every(bucket => /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) ||
        config.bucket === config.mediaBucket || !['qa', 'production'].includes(config.environment) ||
        !/^[A-Za-z0-9]{20,128}$/.test(config.accessKeyId) || !/^[A-Za-z0-9/+=]{32,128}$/.test(config.secretAccessKey)) throw new DeletionLedgerError('INVALID_LEDGER_INTENT');
    this.config = Object.freeze({ ...config });
    this.sourceId = createHash('sha256').update(JSON.stringify(['r2', config.accountId, config.bucket, config.environment])).digest('hex');
    this.client = new S3Client({ region: 'auto', endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      forcePathStyle: true, maxAttempts: 1, followRegionRedirects: false,
      requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
      requestHandler: { connectionTimeout: 2000, socketTimeout: 5000, requestTimeout: 8000,
        httpsAgent: new Agent({ keepAlive: true, maxSockets: 2, maxFreeSockets: 1 }) } });
  }
  private key(key: string): string {
    const parts = key.split('/');
    if (parts.length !== 3 || parts[0] !== this.config.environment || parts[2] !== 'intent.json' ||
        deletionIntentKey(this.config.environment, parts[1]!) !== key) throw new DeletionLedgerError('INVALID_LEDGER_INTENT');
    return key;
  }
  async putIfAbsent(key: string, bytes: Uint8Array, signal: AbortSignal): Promise<void> {
    const record = decodeDeletionIntent(bytes, this.config.environment);
    if (this.key(key) !== deletionIntentKey(this.config.environment, record.requestId)) throw new DeletionLedgerError('INVALID_LEDGER_INTENT');
    // Immutable intent only: no update, delete, public URL or lifecycle capability.
    // Bucket retention/credential separation must be verified before activating this adapter.
    await this.client.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: bytes,
      ContentLength: bytes.length, ContentType: 'application/json', CacheControl: 'private, no-store, max-age=0', IfNoneMatch: '*' }), { abortSignal: signal });
  }
  async read(key: string, signal: AbortSignal): Promise<Uint8Array | null> {
    const checked = this.key(key);
    let body: Readable | undefined;
    const abort = () => body?.destroy(new DeletionLedgerError('LEDGER_UNAVAILABLE'));
    try {
      signal.throwIfAborted();
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: checked }), { abortSignal: signal });
      if (response.Body instanceof Readable) body = response.Body;
      if (!body || response.ContentType !== 'application/json' || !Number.isSafeInteger(response.ContentLength) ||
          response.ContentLength! < 1 || response.ContentLength! > LEDGER_MAX_BYTES) throw new DeletionLedgerError('LEDGER_UNAVAILABLE');
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      let total = 0; const chunks: Buffer[] = [];
      for await (const chunk of body) {
        signal.throwIfAborted();
        if (!(chunk instanceof Uint8Array) || chunk.length > LEDGER_MAX_BYTES - total) throw new DeletionLedgerError('LEDGER_UNAVAILABLE');
        total += chunk.length; chunks.push(Buffer.from(chunk));
      }
      if (total !== response.ContentLength) throw new DeletionLedgerError('LEDGER_UNAVAILABLE');
      return Buffer.concat(chunks, total);
    } catch (error) {
      if (error && typeof error === 'object' && 'name' in error && error.name === 'NoSuchKey' &&
          '$metadata' in error && (error.$metadata as { httpStatusCode?: number } | undefined)?.httpStatusCode === 404) return null;
      throw new DeletionLedgerError('LEDGER_UNAVAILABLE');
    } finally { signal.removeEventListener('abort', abort); body?.destroy(); }
  }
  async list(cursor: string | null, limit: number, signal: AbortSignal): Promise<{ keys: string[]; sizes: (number | undefined)[]; cursor: string | null }> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 ||
        (cursor !== null && (typeof cursor !== 'string' || !cursor.length || cursor.length > 2048))) throw new DeletionLedgerError('INVALID_LEDGER_INTENT');
    try {
      signal.throwIfAborted();
      const page = await this.client.send(new ListObjectsV2Command({ Bucket: this.config.bucket,
        Prefix: `${this.config.environment}/`, MaxKeys: limit, ...(cursor ? { ContinuationToken: cursor } : {}) }), { abortSignal: signal });
      signal.throwIfAborted();
      if ((page.Contents !== undefined && !Array.isArray(page.Contents)) || typeof page.IsTruncated !== 'boolean' || (page.Contents?.length ?? 0) > limit || (page.CommonPrefixes?.length ?? 0) !== 0 ||
          (page.IsTruncated && (!page.NextContinuationToken || page.NextContinuationToken.length > 2048 || page.NextContinuationToken === cursor)) ||
          (!page.IsTruncated && page.NextContinuationToken !== undefined)) throw new DeletionLedgerError('INVALID_LEDGER_INTENT');
      const keys = (page.Contents ?? []).map(item => {
        if (typeof item.Key !== 'string' || !item.Key.startsWith(`${this.config.environment}/`) || Buffer.byteLength(item.Key, 'utf8') > 1024) throw new DeletionLedgerError('INVALID_LEDGER_INTENT');
        return item.Key;
      });
      if (new Set(keys).size !== keys.length) throw new DeletionLedgerError('INVALID_LEDGER_INTENT');
      return { keys, sizes: (page.Contents ?? []).map(item => item.Size), cursor: page.IsTruncated ? page.NextContinuationToken! : null };
    } catch (error) {
      if (error instanceof DeletionLedgerError) throw error;
      throw new DeletionLedgerError('LEDGER_UNAVAILABLE');
    }
  }
  close(): void { this.client.destroy(); }
}
