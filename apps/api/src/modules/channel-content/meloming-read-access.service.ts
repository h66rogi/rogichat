import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { SessionCredentials } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';

@Injectable()
export class MelomingReadAccessService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService) {}

  requireAccount(credentials: SessionCredentials) {
    return this.transactions.read(tx => this.auth.require(tx, credentials, true));
  }
}
