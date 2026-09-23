import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { CommandCredentials } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';
import { ApiError } from '../auth/auth-primitives.js';
import type { MediaStore } from '../media/adapters/media-store.js';
import { mediaKey } from '../media/adapters/media-store.js';
import { MEDIA_PREFIX, MEDIA_STORE } from '../media/media.tokens.js';
import { ChannelContentRepository } from './channel-content.repository.js';

const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' } as const;
type ImageType = keyof typeof IMAGE_TYPES;
const MIME_BY_EXTENSION = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' } as const;
export type ChannelImageUpload = { buffer: Buffer; size: number; mimetype: string };

/** Meloming UploadService.uploadImage contract using Rogichat's R2 media store. */
@Injectable()
export class MelomingUploadService {
  constructor(
    @Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ChannelContentRepository) private readonly repository: ChannelContentRepository,
    @Inject(MEDIA_STORE) private readonly store: MediaStore,
    @Inject(MEDIA_PREFIX) private readonly prefix: string,
  ) {}

  async uploadImage(credentials: CommandCredentials, file: ChannelImageUpload) {
    if (!file || !Buffer.isBuffer(file.buffer) || !Number.isSafeInteger(file.size) ||
      file.size <= 0 || file.size > IMAGE_MAX_BYTES ||
      !(file.mimetype in IMAGE_TYPES)) throw new ApiError('INVALID_REQUEST', 400);
    await this.transactions.read(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      await this.repository.requireOwner(tx, actor.userId);
    });
    const extension = IMAGE_TYPES[file.mimetype as ImageType];
    const id = randomUUID();
    const fileName = `${id}.${extension}`;
    const key = mediaKey(this.prefix, id, id, 'image');
    const directory = await mkdtemp(join(tmpdir(), 'rogichat-channel-image-'));
    try {
      const path = join(directory, fileName);
      await writeFile(path, file.buffer, { flag: 'wx', mode: 0o600 });
      await this.store.put(key, path, file.size, file.mimetype, AbortSignal.timeout(30_000));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    const origin = this.prefix === 'qa' ? 'https://api.qa.rogi.chat' :
      this.prefix === 'production' ? 'https://api.rogi.chat' : 'http://localhost:3000';
    return { fileKey: key, imageUrl: `${origin}/v1/upload/image/${fileName}`, fileName };
  }

  async readImage(fileName: string) {
    const match = /^([a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.(jpg|png|gif|webp)$/.exec(fileName);
    if (!match) throw new ApiError('NOT_FOUND', 404);
    const extension = match[2] as keyof typeof MIME_BY_EXTENSION;
    const key = mediaKey(this.prefix, match[1]!, match[1]!, 'image');
    try {
      const { stream, bytes } = await this.store.read(key, AbortSignal.timeout(30_000));
      if (bytes > IMAGE_MAX_BYTES) { stream.destroy(); throw new Error('invalid_image'); }
      return { stream, bytes, contentType: MIME_BY_EXTENSION[extension] };
    } catch { throw new ApiError('NOT_FOUND', 404); }
  }
}
