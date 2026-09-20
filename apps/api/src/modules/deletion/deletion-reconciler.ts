import type { DeletionLedger } from './deletion-ledger.js';
import type { DeletionApplyService } from './deletion-apply.service.js';

/** Independent of DB jobs and client retries. Each finished pass starts over at the prefix. */
export class DeletionReconciler {
  private cursor: string | null = null;
  private pending: { keys: string[]; cursor: string | null; next: number } | undefined;
  private running = false;
  constructor(private readonly ledger: DeletionLedger, private readonly apply: DeletionApplyService) {}
  async tick(signal?: AbortSignal) {
    if (this.running) return;
    this.running = true;
    const bounded = AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]);
    try {
      if (!this.pending) {
        const page = await this.ledger.inventory(this.cursor, 50, bounded);
        this.pending = { keys: [...page.keys], cursor: page.cursor, next: 0 };
      }
      const page = this.pending;
      let scanned = 0;
      while (page.next < page.keys.length) {
        bounded.throwIfAborted();
        const receipt = await this.ledger.readByKey(page.keys[page.next]!, bounded);
        bounded.throwIfAborted();
        await this.apply.apply(receipt);
        if (receipt.intent.scope === 'ACCOUNT') {
          bounded.throwIfAborted();
          await this.apply.scrubBindings(receipt);
        }
        // Only completed work advances. A failed apply/scrub repeats the same
        // immutable receipt; a deadline never discards earlier page progress.
        page.next++;
        scanned++;
      }
      // Advance only after the whole bounded page is applied. No timestamp watermark.
      bounded.throwIfAborted();
      this.cursor = page.cursor;
      this.pending = undefined;
      return { scanned, passFinished: page.cursor === null };
    } finally { this.running = false; }
  }
}
