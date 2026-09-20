import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { MediaWriteProofRepository } from './media-write-proof.repository.js';
@Injectable()
export class MediaWriteProofService {
  constructor(@Inject(MediaWriteProofRepository) private readonly repository: MediaWriteProofRepository) {}
  acknowledge(tx: Transaction, assetId: string, objectId: string, key: string) { return this.repository.acknowledge(tx, assetId, objectId, key); }
}
