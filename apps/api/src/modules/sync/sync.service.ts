import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import { AuthService } from '../auth/auth.service.js';
import type { SessionCredentials } from '../auth/auth-context.js';
import type { SyncInput } from './dto/sync.dto.js';
import { SyncCoreService } from './sync-core.service.js';

@Injectable()
export class SyncService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SyncCoreService) private readonly sync: SyncCoreService) {}
  manifest(credentials: SessionCredentials, input: SyncInput) {
    return this.transactions.read(async tx => this.sync.manifest(tx, await this.auth.require(tx, credentials, true), input));
  }
  snapshot(credentials: SessionCredentials, roomId: string, input: SyncInput) {
    return this.transactions.read(async tx => this.sync.snapshot(tx, await this.auth.require(tx, credentials, true), roomId, input));
  }
  events(credentials: SessionCredentials, roomId: string, input: SyncInput) {
    return this.transactions.read(async tx => this.sync.events(tx, await this.auth.require(tx, credentials, true), roomId, input));
  }
  history(credentials: SessionCredentials, roomId: string, input: SyncInput) {
    return this.transactions.read(async tx => this.sync.history(tx, await this.auth.require(tx, credentials, true), roomId, input));
  }
  profiles(credentials: SessionCredentials, roomId: string, input: SyncInput) {
    return this.transactions.read(async tx => this.sync.profiles(tx, await this.auth.require(tx, credentials, true), roomId, input));
  }
}
