import { authorizationKey } from '../../infrastructure/config/authorization-epoch.js';
import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import { AuthService } from '../auth/auth.service.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import type { SessionCredentials, CommandCredentials } from '../auth/auth-context.js';
import { UsersCoreService } from './users-core.service.js';
import type { UpdateProfileDto } from './dto/update-profile.dto.js';

@Injectable()
export class UsersService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(UsersCoreService) private readonly users: UsersCoreService) {}
  self(credentials: SessionCredentials) {
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx, credentials);
      return { ...await this.users.selfProfile(tx, actor.userId), soopLinkStatus: actor.soopLinked ? 'VERIFIED' : 'REQUIRED',
        onboardingState: actor.chatEnabled ? 'READY' : 'SOOP_LINK_REQUIRED', capabilities: { chat: actor.chatEnabled } };
    });
  }
  update(credentials: CommandCredentials, input: UpdateProfileDto) {
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials);
      return this.users.updateProfile(tx, actor.userId, input);
    });
  }
  profile(credentials: SessionCredentials, roomId: string, actorId: string) {
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      return { replace: true, profile: await this.users.roomProfile(tx, roomId, actor.userId, actorId, authorizationKey(this.config)) };
    });
  }
  revisions(credentials: SessionCredentials, roomId: string, after?: string) {
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      return this.users.profileManifest(tx, roomId, actor.userId, authorizationKey(this.config), after);
    });
  }
}
