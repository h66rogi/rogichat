import { createHmac } from 'node:crypto';
import { open } from 'node:fs/promises';
import { Inject, Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import type { SessionCredentials, CommandCredentials } from '../../modules/auth/auth-context.js';
import { AuthService } from '../../modules/auth/auth.service.js';
import { AUTH_CONFIG } from '../../modules/auth/auth.tokens.js';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { Transactions } from '../../infrastructure/database/transactions.js';
import { ApiError, object } from '../../modules/auth/auth-primitives.js';
import { consumeRate } from '../../infrastructure/rate-limit/rate-limit.repository.js';
import { identifier } from '../../common/validation/identifier.js';
import { MediaSpooler, MediaSpoolError } from '../../common/media/media-spool.js';
import { assertMediaSignature, MediaPolicyError } from '../../common/media/media-policy.js';
import type { MediaStore } from './adapters/media-store.js';
import { MediaCoreService } from '../../modules/media/media-core.service.js';
import { MEDIA_STORE, MEDIA_PREFIX } from '../../modules/media/media.tokens.js';
const mapped = (error: unknown): never => {
  if (error instanceof MediaPolicyError) throw new ApiError(error.code, error.code === 'MEDIA_FORBIDDEN' ? 403 : 400);
  if (error instanceof MediaSpoolError) throw new ApiError('MEDIA_UPLOAD_FAILED', ['CAPACITY_EXCEEDED', 'CONCURRENCY_EXCEEDED'].includes(error.code) ? 429 : error.code === 'TOO_LARGE' ? 413 : 400);
  throw error;
};
@Injectable()
export class MediaService {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(AUTH_CONFIG) private readonly config: AuthConfig, @Inject(Transactions) private readonly transactions: Transactions, @Inject(MEDIA_STORE) private readonly store: MediaStore, @Inject(MEDIA_PREFIX) private readonly prefix: string, @Inject(MediaSpooler) private readonly spool: MediaSpooler, @Inject(MediaCoreService) private readonly core: MediaCoreService) {}
  async intent(credentials: CommandCredentials, input: unknown) {
    const body = object(input, ['roomId', 'kind', 'contentType', 'byteLength']);
    const roomId = body.roomId === undefined || body.roomId === null ? null : identifier(body.roomId);
    const allowed = await this.transactions.write(async tx => {
      const user = await this.auth.require(tx, credentials, true);
      const key = createHmac('sha256', this.config.key).update(`media-intent:${user.userId}`).digest();
      return consumeRate(tx, key, 10, 60);
    });
    if (!allowed) throw new ApiError('RATE_LIMITED', 429);
    try {
      return await this.transactions.write(async tx => {
        const user = await this.auth.require(tx, credentials, true);
        return this.core.reserveMedia(tx, user.userId, roomId, { kind: body.kind, contentType: body.contentType, byteLength: body.byteLength });
      });
    } catch (error) { return mapped(error); }
  }
  status(credentials: SessionCredentials, assetId: string) {
    return this.transactions.read(async tx => {
      const user = await this.auth.require(tx, credentials, true);
      return this.core.mediaStatus(tx, user.userId, assetId);
    });
  }
  async upload(credentials: CommandCredentials, assetId: string, request: Readable, length: string | undefined) {
    // The raw binary route must never enter JSON/multipart buffering middleware.
    identifier(assetId);
    const { userId, attempt } = await this.transactions.write(async tx => {
      const user = await this.auth.require(tx, credentials, true);
      return { userId: user.userId, attempt: await this.core.beginUpload(tx, user.userId, assetId, this.prefix) };
    });
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.once('aborted', abort);
    // One total deadline spans spool and PUT, in addition to spool idle and transport deadlines.
    const deadline = setTimeout(abort, 300000);
    let spooled: Awaited<ReturnType<MediaSpooler['receive']>> | undefined;
    try {
      if (length !== undefined && (!/^[1-9][0-9]{0,8}$/.test(length) || Number(length) !== attempt.input.byteLength)) throw new ApiError('INVALID_REQUEST', 400);
      spooled = await this.spool.receive(request, { id: attempt.token, maxBytes: attempt.input.byteLength, expectedBytes: attempt.input.byteLength, signal: controller.signal });
      const file = await open(spooled.path, 'r');
      try {
        const prefix = Buffer.alloc(Math.min(4096, spooled.bytes));
        await file.read(prefix, 0, prefix.length, 0);
        assertMediaSignature(attempt.input, prefix);
      } finally { await file.close(); }
      await this.store.put(attempt.key, spooled.path, spooled.bytes, 'application/octet-stream', controller.signal);
      const content = spooled;
      return await this.transactions.write(async tx => {
        await this.auth.require(tx, credentials, true);
        return this.core.finishUpload(tx, userId, attempt, content.bytes, content.sha256);
      });
    } catch (error) {
      // A failed/unknown database commit may already have succeeded. State/token CAS preserves it.
      await this.transactions.write(tx => this.core.failUpload(tx, attempt)).catch(() => {});
      return mapped(error);
    } finally {
      clearTimeout(deadline); request.off('aborted', abort);
      await spooled?.dispose();
    }
  }
  async access(credentials: CommandCredentials, assetId: string, input: unknown) {
    const body = object(input, ['roomId', 'messageId', 'actorId', 'variant']);
    if (typeof body.variant !== 'string') throw new ApiError('INVALID_REQUEST', 400);
    identifier(assetId);
    const context = { variant: body.variant, ...(body.roomId !== undefined ? { roomId: identifier(body.roomId) } : {}), ...(body.messageId !== undefined ? { messageId: identifier(body.messageId) } : {}), ...(body.actorId !== undefined ? { actorId: identifier(body.actorId) } : {}) };
    // Commit admission independently of ACL failures, using one bounded bucket per account.
    // An attacker cannot refund the bucket with inaccessible/random asset identifiers.
    const allowed = await this.transactions.write(async tx => {
      const user = await this.auth.require(tx, credentials, true);
      const rateKey = createHmac('sha256', this.config.key).update(`media-access:${user.userId}`).digest();
      return consumeRate(tx, rateKey, 120, 60);
    });
    if (!allowed) throw new ApiError('RATE_LIMITED', 429);
    const key = await this.transactions.read(async tx => {
      const user = await this.auth.require(tx, credentials, true);
      return this.core.authorizedMediaObject(tx, user.userId, assetId, context);
    });
    return { url: await this.store.signedGet(key), expiresIn: 60 };
  }
}
