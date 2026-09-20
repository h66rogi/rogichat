import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AuthService } from '../auth/auth.service.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { requireCommandProof } from '../auth/auth-context.js';
import type { CommandCredentials, SessionCredentials } from '../auth/auth-context.js';
import { ApiError } from '../auth/auth-primitives.js';
import { identifier } from '../../common/validation/identifier.js';
import { parseNotificationPreferences, parsePushSubscription, parseSubscriptionGeneration } from './notification-contract.js';
import { NotificationsCoreService } from './notifications-core.service.js';
import { PushEndpointPolicy, PushTransport, validatePushKeys } from './push-transport.js';

@Injectable()
export class NotificationsService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(NotificationsCoreService) private readonly core: NotificationsCoreService,
    @Inject(PushTransport) private readonly transport: PushTransport,
    @Inject(PushEndpointPolicy) private readonly endpoints: PushEndpointPolicy) {}
  capabilities(credentials: SessionCredentials): Promise<{ available: false } | { available: true; applicationServerKey: string }> {
    return this.transactions.read(async tx => {
      await this.auth.requireEnrollmentRead(tx, credentials);
      const vapid = this.transport.config.vapid;
      return credentials.transport !== 'NATIVE' && vapid
        ? { available: true, applicationServerKey: vapid.publicKey }
        : { available: false };
    });
  }
  preferences(credentials: SessionCredentials) {
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx, credentials);
      return this.core.preferences(tx, actor.userId);
    });
  }
  setPreferences(credentials: CommandCredentials, value: unknown) {
    const input = parseNotificationPreferences(value); requireCommandProof(credentials);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials);
      if (input.pushEnabled) {
        if (credentials.transport === 'NATIVE') throw new ApiError('AUTH_UNAVAILABLE', 503);
        this.transport.assertAvailable();
      }
      return this.core.setPreferences(tx, actor.userId, input.pushEnabled, input.expectedGeneration);
    });
  }
  async register(credentials: CommandCredentials, value: unknown) {
    const input = parsePushSubscription(value); requireCommandProof(credentials);
    // Authenticate before bounded DNS work; reacquire fresh authorization after it.
    await this.transactions.read(tx => this.auth.require(tx, credentials));
    if (credentials.transport === 'NATIVE') throw new ApiError('AUTH_UNAVAILABLE', 503);
    this.transport.assertAvailable();
    validatePushKeys(input.keys.p256dh, input.keys.auth);
    try { await this.endpoints.validate(input.endpoint); }
    catch (error) {
      if (error instanceof Error && error.message === 'invalid_push_endpoint') throw new ApiError('INVALID_REQUEST', 400);
      throw new ApiError('AUTH_UNAVAILABLE', 503);
    }
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials);
      return this.core.register(tx, actor, this.config.audience, input);
    });
  }
  remove(credentials: CommandCredentials, id: string, value: unknown) {
    identifier(id); const input = parseSubscriptionGeneration(value); requireCommandProof(credentials);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials);
      if (credentials.transport === 'NATIVE') throw new ApiError('AUTH_UNAVAILABLE', 503);
      return this.core.remove(tx, actor, this.config.audience, id, input.generation);
    });
  }
}
