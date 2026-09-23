import { Inject, Injectable } from '@nestjs/common';
import { KaraokePlaybackMode, KaraokeVideoType, SongRequestMode } from '../../generated/prisma/client.js';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { CommandCredentials, SessionCredentials } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';
import { ApiError } from '../auth/auth-primitives.js';
import { ChannelContentRepository } from './channel-content.repository.js';
import { ChannelSongRequestSettingsService } from './upstream/channel-song-request-settings.service.js';
import type { UpdateChannelSongRequestSettingsDto } from './upstream/channel-song-request-settings.service.js';

export function parseSongRequestSettings(value: unknown): UpdateChannelSongRequestSettingsDto {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('INVALID_REQUEST', 400);
  const raw = value as Record<string, unknown>;
  const booleans = ['donationPriorityEnabled','enforceDonationMinimumPrice','donationOnlyEnabled',
    'chatRequestEnabled','donationRequestEnabled','allowAnonymous','requireSongMatch',
    'randomRequestEnabled','preventDuplicateSongs','showRequesterName'];
  const integers: Record<string, [number, number]> = { maxQueueSize:[1,200],maxRequestsPerUser:[0,100],maxTotalRequests:[0,500] };
  const allowed = [...booleans,...Object.keys(integers),'requestCommand','karaokePlaybackMode','karaokeVideoType','requestMode','blockedCategoryIds'];
  if (Object.keys(raw).some(key => !allowed.includes(key))) throw new ApiError('INVALID_REQUEST', 400);
  for (const key of booleans) if (raw[key] !== undefined && typeof raw[key] !== 'boolean') throw new ApiError('INVALID_REQUEST', 400);
  for (const [key,[min,max]] of Object.entries(integers)) if (raw[key] !== undefined &&
    (!Number.isInteger(raw[key]) || Number(raw[key]) < min || Number(raw[key]) > max)) throw new ApiError('INVALID_REQUEST', 400);
  if (raw.requestCommand !== undefined && (typeof raw.requestCommand !== 'string' || raw.requestCommand.length > 50)) throw new ApiError('INVALID_REQUEST', 400);
  for (const [key,values] of [['karaokePlaybackMode',Object.values(KaraokePlaybackMode)],
    ['karaokeVideoType',Object.values(KaraokeVideoType)],['requestMode',Object.values(SongRequestMode)]] as const) {
    if (raw[key] !== undefined && !values.includes(raw[key] as never)) throw new ApiError('INVALID_REQUEST', 400);
  }
  if (raw.blockedCategoryIds !== undefined && (!Array.isArray(raw.blockedCategoryIds) || raw.blockedCategoryIds.length > 100 ||
    raw.blockedCategoryIds.some(id => !Number.isSafeInteger(id) || id < 1))) throw new ApiError('INVALID_REQUEST', 400);
  return raw as UpdateChannelSongRequestSettingsDto;
}

@Injectable()
export class MelomingSongRequestSettingsService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ChannelContentRepository) private readonly repository: ChannelContentRepository) {}

  get(credentials: SessionCredentials) {
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const roomId = await this.repository.requireOwner(tx, actor.userId);
      const service = new ChannelSongRequestSettingsService(tx.prisma);
      return service.toResponseDto(await service.getByChannelId(roomId));
    });
  }

  update(credentials: CommandCredentials, value: unknown) {
    const dto = parseSongRequestSettings(value);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const roomId = await this.repository.requireOwner(tx, actor.userId);
      const service = new ChannelSongRequestSettingsService(tx.prisma);
      const saved = await service.update(roomId, dto);
      return service.toResponseDto(saved);
    });
  }
}
