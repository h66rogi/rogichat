import { Agent } from 'node:https';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ConfigurationError } from '../../../infrastructure/config/config.js';

export interface MediaStore {
  put(key: string, path: string, bytes: number, contentType: string, signal: AbortSignal): Promise<void>;
  read(key: string, signal: AbortSignal): Promise<{ stream: Readable; bytes: number }>;
  remove(key: string, signal: AbortSignal): Promise<void>;
  signedGet(key: string): Promise<string>;
}
export interface MediaConfig { accountId: string; bucket: string; accessKeyId: string; secretAccessKey: string; prefix: string }
export function readMediaConfig(environment: string, env: NodeJS.ProcessEnv = process.env): MediaConfig | undefined {
  if (!env.MEDIA_SECRET_FILE) return undefined; // No credential/config means no media routes, never public fallback.
  try {
    const file = statSync(env.MEDIA_SECRET_FILE);
    if (!file.isFile() || file.size > 4096 || (file.mode & 0o007) !== 0) throw new Error();
    const value: unknown = JSON.parse(readFileSync(env.MEDIA_SECRET_FILE, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const v = value as Record<string, unknown>;
    if (Object.keys(v).sort().join(',') !== 'accessKeyId,accountId,bucket,secretAccessKey' ||
      typeof v.accountId !== 'string' || !/^[a-f0-9]{32}$/.test(v.accountId) ||
      typeof v.bucket !== 'string' || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(v.bucket) ||
      typeof v.accessKeyId !== 'string' || !/^[A-Za-z0-9]{20,128}$/.test(v.accessKeyId) ||
      typeof v.secretAccessKey !== 'string' || !/^[A-Za-z0-9/+=]{32,128}$/.test(v.secretAccessKey) ||
      !['local', 'test', 'qa', 'production'].includes(environment)) throw new Error();
    return Object.freeze({ accountId: v.accountId, bucket: v.bucket, accessKeyId: v.accessKeyId, secretAccessKey: v.secretAccessKey, prefix: environment });
  } catch { throw new ConfigurationError('MEDIA_SECRET_FILE'); }
}
const id = '[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
export function mediaKey(prefix: string, assetId: string, attemptId: string, variant: string): string {
  const key = `${prefix}/${assetId}/${attemptId}/${variant}`;
  if (!new RegExp(`^(local|test|qa|production)/${id}/${id}/(input|image|video|poster)$`).test(key)) throw new Error('invalid_media_key');
  return key;
}
export class R2MediaStore implements MediaStore {
  private readonly client: S3Client;
  constructor(private readonly config: MediaConfig) {
    this.client = new S3Client({ region: 'auto', endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      forcePathStyle: true, maxAttempts: 1, followRegionRedirects: false,
      requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
      requestHandler: { connectionTimeout: 3000, socketTimeout: 30000, requestTimeout: 300000,
        httpsAgent: new Agent({ keepAlive: true, maxSockets: 4, maxFreeSockets: 2 }) } });
  }
  private key(value: string): string {
    const parts = value.split('/');
    if (parts.length !== 4 || parts[0] !== this.config.prefix) throw new Error('invalid_media_key');
    return mediaKey(parts[0], parts[1]!, parts[2]!, parts[3]!);
  }
  async put(key: string, path: string, bytes: number, contentType: string, signal: AbortSignal): Promise<void> {
    if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > 52 * 1024 * 1024 ||
      !['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'application/octet-stream'].includes(contentType)) throw new Error('invalid_media_put');
    const file = statSync(path);
    if (!file.isFile() || file.size !== bytes) throw new Error('invalid_media_put');
    const stream = createReadStream(path, { highWaterMark: 64 * 1024 });
    try {
      await this.client.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: this.key(key), Body: stream,
        ContentLength: bytes, ContentType: contentType, CacheControl: 'private, no-store, max-age=0',
        ContentDisposition: 'inline', IfNoneMatch: '*' }), { abortSignal: signal });
    } finally { stream.destroy(); }
  }
  async read(key: string, signal: AbortSignal) {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: this.key(key) }), { abortSignal: signal });
    if (!(response.Body instanceof Readable) || !Number.isSafeInteger(response.ContentLength) || response.ContentLength! <= 0 || response.ContentLength! > 52 * 1024 * 1024) {
      if (response.Body instanceof Readable) response.Body.destroy();
      throw new Error('invalid_media_object');
    }
    return { stream: response.Body, bytes: response.ContentLength! };
  }
  async remove(key: string, signal: AbortSignal): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: this.key(key) }), { abortSignal: signal });
  }
  signedGet(key: string): Promise<string> {
    // Local signing only; caller must authorize immediately before this operation. No presigned PUT API.
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.config.bucket, Key: this.key(key) }), { expiresIn: 60 });
  }
  close(): void { this.client.destroy(); }
}
