import { BlockRoomsCursor } from './block-rooms-cursor.js';
import { roomCommandRate } from '../../infrastructure/rate-limit/room-command-rate.js';
import { ApiError } from '../auth/auth-primitives.js';
import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { authorizationKey } from '../../infrastructure/config/authorization-epoch.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { AuthService } from '../auth/auth.service.js';
import { requireCommandProof } from '../auth/auth-context.js';
import type { CommandCredentials, SessionCredentials } from '../auth/auth-context.js';
import { ModerationCoreService } from './moderation-core.service.js';
import { reportInput, resolutionInput } from './moderation.dto.js';
@Injectable()
export class ModerationService {
  private readonly recoveryCursor: BlockRoomsCursor;
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(ModerationCoreService) private readonly core: ModerationCoreService) { this.recoveryCursor = new BlockRoomsCursor(authorizationKey(config), config.audience); }
  private write<T>(credentials: CommandCredentials, operation: (tx: Transaction, userId: string) => Promise<T>, linked = false) {
    requireCommandProof(credentials);
    return this.transactions.write(async tx => operation(tx, (await this.auth.require(tx, credentials, linked)).userId));
  }
  async report(credentials: CommandCredentials, roomId: string, messageId: string, body: unknown) {
    const input = reportInput(body);
    requireCommandProof(credentials);
    const allowed = await this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      return roomCommandRate(tx, this.config.key, actor.userId, roomId, 'report');
    });
    if (!allowed) throw new ApiError('RATE_LIMITED', 429);
    return this.write(credentials, (tx, userId) => this.core.report(tx, userId, roomId, messageId, input, this.config.key), true);
  }
  receipt(credentials: SessionCredentials, id: string, byKey = false) {
    return this.transactions.read(async tx => this.core.receipt(tx, (await this.auth.require(tx, credentials)).userId, id, byKey));
  }
  blockRooms(credentials: SessionCredentials, cursor: unknown) {
    return this.transactions.read(async tx => {
      const principal = await this.auth.require(tx, credentials);
      const now = await tx.now();
      const result = await this.core.blockRooms(tx, principal.userId, this.recoveryCursor.after(cursor, principal, now), principal.soopLinked);
      return { rooms: result.rooms, nextCursor: this.recoveryCursor.next(result.nextRoomId, principal, now) };
    });
  }
  blocks(credentials: SessionCredentials, roomId: string, after: string) {
    return this.transactions.read(async tx => this.core.blocks(tx, (await this.auth.require(tx, credentials)).userId, roomId, after));
  }
  block(credentials: CommandCredentials, roomId: string, actorId: string, blocked: boolean) {
    return this.write(credentials, (tx, userId) => this.core.block(tx, userId, roomId, actorId, blocked), blocked);
  }
  bans(credentials: SessionCredentials, roomId: string, after: string) {
    return this.transactions.write(async tx => this.core.bans(tx, (await this.auth.require(tx, credentials, true)).userId, roomId, after));
  }
  ban(credentials: CommandCredentials, roomId: string, actorId: string, banned: boolean) {
    return this.write(credentials, (tx, userId) => this.core.ban(tx, userId, roomId, actorId, banned), true);
  }
  review(credentials: SessionCredentials, after: string) {
    // Authenticated GET has a write transaction solely for current capability
    // locks and the durable access audit; it does not change report state.
    return this.transactions.write(async tx => this.core.review(tx, (await this.auth.require(tx, credentials)).userId, after));
  }
  resolve(credentials: CommandCredentials, reportId: string, body: unknown) {
    const input = resolutionInput(body);
    return this.write(credentials, (tx, userId) => this.core.resolve(tx, userId, reportId, input.status));
  }
}
