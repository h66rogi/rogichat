import { Agent } from 'node:https';
import { Readable } from 'node:stream';
import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { mediaKey } from './adapters/media-store.js';
import type { MediaConfig } from './adapters/media-store.js';
import { restoreMediaDigest, RESTORE_MEDIA_MAXIMUMS } from './restore-media.types.js';
import type { RestoreMediaStore } from './restore-media.types.js';

/** Existing fixed R2 configuration only; provisioning/permission widening is not this port's job. */
export const RESTORE_MEDIA_REQUIRED_PERMISSIONS = Object.freeze(['s3:ListBucket', 's3:GetObject'] as const);
export class RestoreMediaR2Store implements RestoreMediaStore {
  private readonly client: S3Client;
  private readonly config: Readonly<MediaConfig>;
  readonly prefix: string;
  readonly storageScopeSha256: string;
  constructor(config: MediaConfig) {
    if (!/^[a-f0-9]{32}$/.test(config.accountId) || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.bucket) || !['local', 'test', 'qa', 'production'].includes(config.prefix)) throw new Error('restore_media_configuration');
    this.prefix = config.prefix;
    this.config = Object.freeze({ ...config });
    this.storageScopeSha256 = restoreMediaDigest({ accountId: config.accountId, bucket: config.bucket, prefix: config.prefix });
    Object.defineProperties(this, { prefix: { writable: false, configurable: false }, storageScopeSha256: { writable: false, configurable: false } });
    this.client = new S3Client({ region: 'auto', endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, forcePathStyle: true,
      maxAttempts: 1, followRegionRedirects: false, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
      requestHandler: { connectionTimeout: 3000, socketTimeout: 30000, requestTimeout: 300000,
        httpsAgent: new Agent({ keepAlive: true, maxSockets: 1, maxFreeSockets: 1 }) } });
  }
  async list(cursor: string | null, signal: AbortSignal) {
    const response = await this.client.send(new ListObjectsV2Command({ Bucket: this.config.bucket, Prefix: `${this.prefix}/`, MaxKeys: 1000,
      ...(cursor === null ? {} : { ContinuationToken: cursor }) }), { abortSignal: signal });
    if (typeof response.IsTruncated !== 'boolean' || (response.Contents?.length ?? 0) > 1000 ||
      (response.IsTruncated && (!response.NextContinuationToken || response.NextContinuationToken.length > 2048))) throw new Error('restore_media_inventory');
    const objects = (response.Contents ?? []).map(object => {
      if (!object.Key || !object.Key.startsWith(`${this.prefix}/`) || object.Key.length > 1024 || !Number.isSafeInteger(object.Size) || object.Size! < 0 ||
        !object.ETag || object.ETag.length > 256 || !(object.LastModified instanceof Date) || !Number.isFinite(object.LastModified.getTime())) throw new Error('restore_media_inventory');
      return { key: object.Key, bytes: object.Size!, etag: object.ETag, modified: object.LastModified.toISOString() };
    });
    return { objects, next: response.IsTruncated ? response.NextContinuationToken! : null };
  }
  async read(key: string, signal: AbortSignal) {
    const parts = key.split('/');
    if (parts.length !== 4 || parts[0] !== this.prefix || mediaKey(parts[0], parts[1]!, parts[2]!, parts[3]!) !== key) throw new Error('restore_media_key');
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }), { abortSignal: signal });
    if (!(response.Body instanceof Readable) || !Number.isSafeInteger(response.ContentLength) || response.ContentLength! <= 0 ||
      response.ContentLength! > RESTORE_MEDIA_MAXIMUMS.objectBytes || !response.ETag || response.ETag.length > 256) {
      if (response.Body instanceof Readable) response.Body.destroy();
      throw new Error('restore_media_object');
    }
    return { stream: response.Body, bytes: response.ContentLength!, etag: response.ETag };
  }
  close(): void { this.client.destroy(); }
}
