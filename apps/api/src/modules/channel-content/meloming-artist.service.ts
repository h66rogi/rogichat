import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { CommandCredentials } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';
import { ApiError } from '../auth/auth-primitives.js';
import { ChannelContentRepository } from './channel-content.repository.js';
import { ArtistService } from './upstream/artist.service.js';

function name(value: unknown): { name: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== 1 || typeof (value as Record<string, unknown>).name !== 'string') throw new ApiError('INVALID_REQUEST', 400);
  const text = (value as { name: string }).name.trim();
  if (!text || text.length > 255) throw new ApiError('INVALID_REQUEST', 400);
  return { name: text };
}

function artistDto(row: { id: number; name: string; createdAt: Date | null }) {
  return { id: row.id, name: row.name, channelId: 1, createdAt: row.createdAt };
}

@Injectable()
export class MelomingArtistService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ChannelContentRepository) private readonly repository: ChannelContentRepository) {}

  create(credentials: CommandCredentials, value: unknown) {
    const dto = name(value);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const roomId = await this.repository.requireOwner(tx, actor.userId);
      await this.repository.lockPrimary(tx);
      return artistDto(await new ArtistService(tx.prisma).createArtistByChannelId(dto, roomId));
    });
  }

  update(credentials: CommandCredentials, id: number, value: unknown) {
    const dto = name(value);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const roomId = await this.repository.requireOwner(tx, actor.userId);
      await this.repository.lockPrimary(tx);
      return artistDto(await new ArtistService(tx.prisma).updateArtistByChannelId(id, dto, roomId));
    });
  }

  remove(credentials: CommandCredentials, id: number) {
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const roomId = await this.repository.requireOwner(tx, actor.userId);
      await this.repository.lockPrimary(tx);
      return new ArtistService(tx.prisma).deleteArtistByChannelId(id, roomId);
    });
  }
}
