import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { CommandCredentials } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';
import { ApiError } from '../auth/auth-primitives.js';
import { ChannelContentRepository } from './channel-content.repository.js';
import type { ConsoleCredentials } from './meloming-live-session.service.js';
import { readMelomingGatewayConfig } from './meloming-gateway-config.js';

@Injectable()
export class MelomingConsolePlaybackService {
  constructor(
    @Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ChannelContentRepository) private readonly repository: ChannelContentRepository,
  ) {}

  create(credentials: CommandCredentials | ConsoleCredentials, sessionId: number, value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('INVALID_REQUEST', 400);
    const body = value as Record<string, unknown>;
    if (Object.keys(body).some(key => !['videoUrl','songId'].includes(key)) ||
        typeof body.videoUrl !== 'string' || body.videoUrl.length > 2048 || !body.videoUrl ||
        (body.songId !== undefined && (!Number.isSafeInteger(body.songId) || Number(body.songId) < 1))) {
      throw new ApiError('INVALID_REQUEST', 400);
    }
    const config = readMelomingGatewayConfig();
    if (!config) throw new ServiceUnavailableException('Media gateway is not configured');
    return this.transactions.write(async tx => {
      const roomId = 'consoleToken' in credentials
        ? (await this.repository.requireConsoleToken(tx, credentials.consoleToken)).roomId
        : await this.repository.requireOwner(tx, (await this.auth.require(tx, credentials, true)).userId);
      const session = await tx.prisma.liveSession.findFirst({ where: { id: sessionId, channelId: roomId }, select: { id: true } });
      if (!session) throw new ApiError('FORBIDDEN', 403);
      const sourceConfig = { get<T>(name: string): T | undefined {
        const values: Record<string, string | number> = {
          MEDIA_GATEWAY_BASE_URL: config.baseUrl,
          MEDIA_GATEWAY_SIGN_SECRET: config.signSecret,
          MEDIA_GATEWAY_URL_TTL_SECONDS: config.ttlSeconds,
        };
        return values[name] as T | undefined;
      } };
      return this.repository.consolePlayback(tx, sourceConfig).createPlaybackUrl(body.videoUrl as string,
        body.songId as number | undefined);
    });
  }
}
