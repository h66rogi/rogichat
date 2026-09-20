import type { DeletionLedger } from './deletion-ledger.js';
import type { DeletionApplyService } from './deletion-apply.service.js';

/** Independent of DB jobs and client retries. Each finished pass starts over at the prefix. */
export class DeletionReconciler {
  private cursor: string | null = null;
  private running = false;
  constructor(private readonly ledger: DeletionLedger, private readonly apply: DeletionApplyService) {}
  async tick(signal?: AbortSignal) {
    if (this.running) return;
    this.running = true;
    const bounded = AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]);
    try {
      const page = await this.ledger.inventory(this.cursor, 50, bounded);
      for (const key of page.keys) {
        bounded.throwIfAborted();
        const receipt = await this.ledger.readByKey(key, bounded);
        bounded.throwIfAborted();
        if (receipt.intent.scope !== 'MESSAGE') throw new Error('unsupported_deletion_scope');
        await this.apply.apply(receipt);
      }
      // Advance only after the whole bounded page is applied. No timestamp watermark.
      bounded.throwIfAborted();
      this.cursor = page.cursor;
      return { scanned: page.keys.length, passFinished: page.cursor === null };
    } finally { this.running = false; }
  }
}
