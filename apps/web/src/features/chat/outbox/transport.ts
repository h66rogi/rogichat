import { receipt, type Receipt } from '../contract';
import type { OutboxPayload } from './model';
import type { DurableOutbox } from './indexeddb';
import { normalizePayload } from './model';

export interface OutboxTransport {
  /** Recheck genuine current session, room/payload capability and controller generation. */
  verify(): Promise<void>;
  lookup(id: string, signal: AbortSignal): Promise<unknown>;
  send(payload: OutboxPayload, signal: AbortSignal): Promise<unknown>;
}
/** Receipt-only recovery. A 404 is never success and never invokes SEND. */
export async function reconcileOutbox(outbox: DurableOutbox, id: string, transport: OutboxTransport): Promise<Receipt> {
  await transport.verify(); await outbox.beforeLookup(id);
  const result = receipt(await transport.lookup(id, outbox.signal), id, 'lookup');
  await outbox.assertCurrent(); await transport.verify(); await outbox.assertCurrent();
  await outbox.settle(result); return result;
}
/** Explicit user intent only; caller retains input until this returns a committed/deleted receipt. */
export async function sendOutbox(outbox: DurableOutbox, roomId: string, input: OutboxPayload, transport: OutboxTransport): Promise<Receipt> {
  const payload = normalizePayload(input);
  await transport.verify(); await outbox.assertCurrent();
  await outbox.prepare(roomId, payload);
  await transport.verify(); await outbox.assertCurrent();
  const frozen = normalizePayload(await outbox.beforeSend(payload.clientMessageId));
  const result = receipt(await transport.send(frozen, outbox.signal), payload.clientMessageId, 'send');
  await outbox.assertCurrent(); await transport.verify(); await outbox.assertCurrent();
  await outbox.settle(result); return result;
}

/** The retry control has to call this explicitly; background/cold recovery calls reconcileOutbox. */
export async function retryOutbox(outbox: DurableOutbox, id: string, transport: OutboxTransport): Promise<Receipt> {
  await transport.verify(); await outbox.beforeLookup(id);
  let result: Receipt | undefined;
  try { result = receipt(await transport.lookup(id, outbox.signal), id, 'lookup'); }
  catch (error) {
    if (!(error && typeof error === 'object' && 'status' in error && error.status === 404)) throw error;
  }
  await outbox.assertCurrent(); await transport.verify(); await outbox.assertCurrent();
  if (result) { await outbox.settle(result); return result; }
  await outbox.lookupNotFound(id);
  const frozen = normalizePayload(await outbox.beforeSend(id, true));
  result = receipt(await transport.send(frozen, outbox.signal), id, 'send');
  await outbox.assertCurrent(); await transport.verify(); await outbox.assertCurrent();
  await outbox.settle(result); return result;
}
