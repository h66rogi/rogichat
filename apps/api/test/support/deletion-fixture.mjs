// Isolated tests only. Never imported by src or a runtime composition.
import { randomBytes } from 'node:crypto';
import { DeletionLedger } from '../../dist/modules/deletion/deletion-ledger.js';
export class TestLedgerStore {
  sourceId = randomBytes(32).toString('hex');
  rows = new Map(); loseAck = false; fail = false; beforePut;
  async read(key) { if (this.fail) throw new Error('synthetic_store_failure'); return this.rows.get(key) ?? null; }
  async putIfAbsent(key, bytes) {
    await this.beforePut?.();
    if (this.fail) throw new Error('synthetic_store_failure');
    if (!this.rows.has(key)) this.rows.set(key, Buffer.from(bytes));
    if (this.loseAck) throw new Error('synthetic_lost_ack');
  }
  async list(cursor, limit) {
    if (this.fail) throw new Error('synthetic_store_failure');
    const keys = [...this.rows.keys()].sort().filter(key => cursor === null || key > cursor);
    return { keys: keys.slice(0, limit), cursor: keys.length > limit ? keys[limit - 1] : null };
  }
  close() {}
}
export function deletionFixture() {
  const store = new TestLedgerStore();
  return { store, ledger: new DeletionLedger(store, 'qa') };
}
