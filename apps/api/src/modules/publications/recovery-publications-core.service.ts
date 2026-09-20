import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { ApiError } from '../auth/auth-primitives.js';
import { PublicationsCoreService } from './publications-core.service.js';

// Fixed recovery composition: preserve cleanup/fences for existing copies while
// restoring the known-good text-only publication eligibility.
@Injectable()
export class RecoveryPublicationsCoreService extends PublicationsCoreService {
  protected override async sourceForOwner(tx: Transaction, roomId: string, userId: string, messageId: string) {
    const result = await super.sourceForOwner(tx, roomId, userId, messageId);
    if (result.source.content_kind !== 'TEXT' || result.source.text_content === null) throw new ApiError('INVALID_REQUEST', 400);
    return result;
  }
}
