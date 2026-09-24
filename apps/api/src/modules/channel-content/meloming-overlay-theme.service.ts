import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { CommandCredentials, SessionCredentials } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';
import { ApiError } from '../auth/auth-primitives.js';
import { ChannelContentRepository } from './channel-content.repository.js';
import { OverlayThemeService } from './upstream/overlay-theme.service.js';
import type { UpdateOverlayThemeDto } from './upstream/dto/request/overlay-theme.request.dto.js';
import type { ConsoleCredentials } from './meloming-live-session.service.js';

@Injectable()
export class MelomingOverlayThemeService {
  constructor(
    @Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ChannelContentRepository) private readonly repository: ChannelContentRepository,
  ) {}

  get(credentials: SessionCredentials | ConsoleCredentials) {
    return this.transactions.write(async tx => {
      const roomId = 'consoleToken' in credentials
        ? (await this.repository.requireConsoleToken(tx, credentials.consoleToken)).roomId
        : await this.repository.requireOwner(tx, (await this.auth.require(tx, credentials, true)).userId);
      return new OverlayThemeService(tx.prisma).getThemeConfig(roomId);
    });
  }

  update(credentials: CommandCredentials | ConsoleCredentials, value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('INVALID_REQUEST', 400);
    const body = value as Record<string, unknown>;
    if (Object.keys(body).some(key => !['themeId', 'options', 'widgets'].includes(key)) ||
      typeof body.themeId !== 'string' ||
      (body.options !== undefined && (!body.options || typeof body.options !== 'object' || Array.isArray(body.options))) ||
      (body.widgets !== undefined && (!body.widgets || typeof body.widgets !== 'object' || Array.isArray(body.widgets)))) throw new ApiError('INVALID_REQUEST', 400);
    return this.transactions.write(async tx => {
      const roomId = 'consoleToken' in credentials
        ? (await this.repository.requireConsoleToken(tx, credentials.consoleToken)).roomId
        : await this.repository.requireOwner(tx, (await this.auth.require(tx, credentials, true)).userId);
      return new OverlayThemeService(tx.prisma).updateThemeConfig(roomId, body as unknown as UpdateOverlayThemeDto);
    });
  }
}
