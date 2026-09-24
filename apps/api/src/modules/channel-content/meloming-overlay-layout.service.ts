import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { CommandCredentials, SessionCredentials } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';
import { ApiError } from '../auth/auth-primitives.js';
import { ChannelContentRepository } from './channel-content.repository.js';
import { OverlayLayoutService } from './upstream/overlay-layout.service.js';
import type { ConsoleCredentials } from './meloming-live-session.service.js';

@Injectable()
export class MelomingOverlayLayoutService {
  constructor(
    @Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ChannelContentRepository) private readonly repository: ChannelContentRepository,
  ) {}

  get(credentials: SessionCredentials | ConsoleCredentials, layoutType: string) {
    return this.transactions.read(async tx => {
      const roomId = 'consoleToken' in credentials
        ? (await this.repository.requireConsoleToken(tx, credentials.consoleToken)).roomId
        : await this.repository.requireOwner(tx, (await this.auth.require(tx, credentials, true)).userId);
      const original = new OverlayLayoutService(tx.prisma);
      const normalized = original.validateLayoutType(layoutType);
      return { layoutType: normalized, ...await original.getLayoutSnapshot(roomId, normalized) };
    });
  }

  update(credentials: CommandCredentials | ConsoleCredentials, layoutType: string, value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).join(',') !== 'layout') throw new ApiError('INVALID_REQUEST', 400);
    const layout = (value as Record<string, unknown>).layout;
    if (!layout || typeof layout !== 'object' || Array.isArray(layout)) throw new ApiError('INVALID_REQUEST', 400);
    return this.transactions.write(async tx => {
      const roomId = 'consoleToken' in credentials
        ? (await this.repository.requireConsoleToken(tx, credentials.consoleToken)).roomId
        : await this.repository.requireOwner(tx, (await this.auth.require(tx, credentials, true)).userId);
      const original = new OverlayLayoutService(tx.prisma);
      const normalized = original.validateLayoutType(layoutType);
      return { layoutType: normalized, ...await original.upsertLayout(roomId, normalized, layout as Record<string, unknown>) };
    });
  }
}
