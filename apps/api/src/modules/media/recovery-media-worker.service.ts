import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import type { JobLease } from '../jobs/jobs.policy.js';
import { JobFailure } from '../jobs/jobs.service.js';
import { MediaWorkerService } from './media-worker.service.js';

// Admission and its rejection share the caller transaction: no video allocation
// can commit. Existing DELETING assets still use the retained cleanup handler.
@Injectable()
export class RecoveryMediaWorkerService extends MediaWorkerService {
  override async prepareMedia(tx: Transaction, lease: JobLease) {
    const attempt = await super.prepareMedia(tx, lease);
    if (typeof attempt !== 'string' && attempt.input.kind === 'VIDEO') throw new JobFailure('INVALID_RESOURCE', true);
    return attempt;
  }
}
