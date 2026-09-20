import { Agent } from 'node:https';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { S3Client, S3ServiceException, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ConfigurationError } from '../../../infrastructure/config/config.js';

export interface MediaStore {
  put(key: string, path: string, bytes: number, contentType: string, signal: AbortSignal): Promise<void>;
  read(key: string, signal: AbortSignal): Promise<{ stream: Readable; bytes: number }>;
  // Resolves only after direct storage read-back proves this immutable key absent.
  // Point-in-time proof; callers still own late-writer guards and lease fences.
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
    const input = { Bucket: this.config.bucket, Key: this.key(key) };
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timeout = setTimeout(abort, 30_000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    let rejectAborted: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      rejectAborted = () => reject(new Error('media_absence_unverified'));
      controller.signal.addEventListener('abort', rejectAborted, { once: true });
    });
    const verify = async () => {
      controller.signal.throwIfAborted();
      try {
        await this.client.send(new DeleteObjectCommand(input), { abortSignal: controller.signal });
      } catch (error) {
        // A lost ACK can be recovered by read-back, but an explicit client/write
        // rejection must never be converted to successful cleanup.
        if (error instanceof Error && ['AccessDenied', 'Forbidden', 'InvalidAccessKeyId', 'SignatureDoesNotMatch'].includes(error.name)) throw error;
        if (error instanceof S3ServiceException && error.$metadata.httpStatusCode !== undefined &&
          error.$metadata.httpStatusCode >= 400 && error.$metadata.httpStatusCode < 500) throw error;
      }
      controller.signal.throwIfAborted();
      try {
        await this.client.send(new HeadObjectCommand(input), { abortSignal: controller.signal });
      } catch (error) {
        controller.signal.throwIfAborted();
        if (!(error instanceof S3ServiceException) || error.$metadata.httpStatusCode !== 404 ||
          !['NotFound', 'NoSuchKey'].includes(error.name)) throw error;
        // HEAD has no error body and can conflate an absent bucket with an absent
        // object. Never cache this existence proof or broaden credentials for it.
        const bucket = await this.client.send(new HeadBucketCommand({ Bucket: input.Bucket }), { abortSignal: controller.signal });
        controller.signal.throwIfAborted();
        if (bucket.$metadata.httpStatusCode !== 200) throw error;
        return;
      }
      throw new Error(); // Any successful HEAD means the object still exists.
    };
    try { await Promise.race([verify(), aborted]); controller.signal.throwIfAborted(); }
    catch { throw new Error('media_absence_unverified'); }
    finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      controller.signal.removeEventListener('abort', rejectAborted);
    }
  }
  signedGet(key: string): Promise<string> {
    // Local signing only; caller must authorize immediately before this operation. No presigned PUT API.
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.config.bucket, Key: this.key(key) }), { expiresIn: 60 });
  }
  close(): void { this.client.destroy(); }
}
