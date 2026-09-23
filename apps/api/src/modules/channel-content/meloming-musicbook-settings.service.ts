import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { CommandCredentials } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';
import { ApiError } from '../auth/auth-primitives.js';
import { ChannelContentRepository } from './channel-content.repository.js';
import { ChannelMusicbookSettingsService } from './upstream/channel-musicbook-settings.service.js';

/** Authentication and room-key adapter around the copied Meloming service. */
@Injectable()
export class MelomingMusicbookSettingsService {
  constructor(
    @Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ChannelContentRepository) private readonly repository: ChannelContentRepository,
  ) {}

  getSettings() {
    return this.transactions.read(async tx => {
      const { roomId } = await this.repository.primary(tx);
      return new ChannelMusicbookSettingsService(tx.prisma).getSettings(roomId);
    });
  }

  updateSettings(credentials: CommandCredentials, value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== 1 || typeof (value as Record<string, unknown>).useProficiencyAsPrimary !== 'boolean') {
      throw new ApiError('INVALID_REQUEST', 400);
    }
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const roomId = await this.repository.requireOwner(tx, actor.userId);
      await this.repository.lockPrimary(tx);
      return new ChannelMusicbookSettingsService(tx.prisma).updateSettings(roomId, {
        useProficiencyAsPrimary: (value as { useProficiencyAsPrimary: boolean }).useProficiencyAsPrimary,
      });
    });
  }

  copyDifficultyToProficiency(credentials: CommandCredentials) {
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const roomId = await this.repository.requireOwner(tx, actor.userId);
      await this.repository.lockPrimary(tx);
      return new ChannelMusicbookSettingsService(tx.prisma).copyDifficultyToProficiency(roomId);
    });
  }
}
