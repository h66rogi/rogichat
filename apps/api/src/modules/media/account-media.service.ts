import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import type { DeletionReceipt } from '../deletion/deletion-ledger.js';
import { AccountMediaRepository } from './account-media.repository.js';
import type { MediaBasis } from './account-media.repository.js';

/** Internal port: admitted ACCOUNT transaction owns account/room locks and final queue fence. */
@Injectable()
export class AccountMediaService {
  constructor(@Inject(AccountMediaRepository) private readonly repository: AccountMediaRepository) {}
  admit(tx: Transaction, receipt: DeletionReceipt, basis: MediaBasis) { return this.repository.admit(tx, receipt, basis); }
  page(tx: Transaction, receipt: DeletionReceipt) { return this.repository.page(tx, receipt); }
}
