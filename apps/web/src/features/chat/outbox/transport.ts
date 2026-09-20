import { receipt, type Receipt } from '../contract';
import type { OutboxPayload } from './model';
import type { DurableOutbox } from './indexeddb';
import { normalizePayload, OutboxError } from './model';

function active(signal: AbortSignal) {
  if (signal.aborted) throw new OutboxError('LOCKED');
}
async function current(outbox: DurableOutbox, signal: AbortSignal) {
  active(signal);
  await outbox.assertCurrent();
  active(signal);
}

export interface OutboxTransport {
  /** Recheck genuine current session, room/payload capability and controller generation. */
  verify(): Promise<void>;
  lookup(id: string, signal: AbortSignal): Promise<unknown>;
  send(payload: OutboxPayload, signal: AbortSignal): Promise<unknown>;
}
/** Receipt-only recovery. A 404 is never success and never invokes SEND. */
export async function reconcileOutbox(outbox: DurableOutbox, id: string, transport: OutboxTransport): Promise<Receipt> {
  const signal = outbox.signal;
  await transport.verify(); active(signal); await outbox.beforeLookup(id); active(signal);
  const result = receipt(await transport.lookup(id, signal), id, 'lookup');
  await current(outbox, signal); await transport.verify(); await current(outbox, signal);
  active(signal); await outbox.settle(result); active(signal); return result;
}
/** Explicit user intent only; caller retains input until this returns a committed/deleted receipt. */
export async function sendOutbox(outbox: DurableOutbox, roomId: string, input: OutboxPayload, transport: OutboxTransport): Promise<Receipt> {
  const payload = normalizePayload(input);
  const signal = outbox.signal;
  await transport.verify(); await current(outbox, signal);
  active(signal); await outbox.prepare(roomId, payload);
  await current(outbox, signal); await transport.verify(); await current(outbox, signal);
  active(signal); const frozen = normalizePayload(await outbox.beforeSend(payload.clientMessageId));
  active(signal);
  const result = receipt(await transport.send(frozen, signal), payload.clientMessageId, 'send');
  await current(outbox, signal); await transport.verify(); await current(outbox, signal);
  active(signal); await outbox.settle(result); active(signal); return result;
}

/** The retry control has to call this explicitly; background/cold recovery calls reconcileOutbox. */
export async function retryOutbox(outbox: DurableOutbox, id: string, transport: OutboxTransport): Promise<Receipt> {
  const signal = outbox.signal;
  await transport.verify(); active(signal); await outbox.beforeLookup(id); active(signal);
  let result: Receipt | undefined;
  try { result = receipt(await transport.lookup(id, signal), id, 'lookup'); }
  catch (error) {
    if (!(error && typeof error === 'object' && 'status' in error && error.status === 404)) throw error;
  }
  await current(outbox, signal); await transport.verify(); await current(outbox, signal);
  if (result) { active(signal); await outbox.settle(result); active(signal); return result; }
  active(signal); await outbox.lookupNotFound(id);
  await current(outbox, signal);
  active(signal); const frozen = normalizePayload(await outbox.beforeSend(id, true));
  active(signal);
  result = receipt(await transport.send(frozen, signal), id, 'send');
  await current(outbox, signal); await transport.verify(); await current(outbox, signal);
  active(signal); await outbox.settle(result); active(signal); return result;
}
