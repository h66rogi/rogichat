import type { Session } from '@/core/api/client';
import { DurableOutbox, outboxSessionKey } from '@/features/chat/outbox/indexeddb';
import { revokeChatOutboxes } from '@/features/chat/chat-controller';

export function outboxEnvironment(origin: string): string {
  if (origin === 'https://api.qa.rogi.chat') return 'qa';
  if (origin === 'https://api.rogi.chat') return 'production';
  throw new Error('INVALID_ORIGIN');
}
export async function cleanupBinding(origin: string, session: Session): Promise<string> {
  return outboxSessionKey(outboxEnvironment(origin), session.csrfToken);
}
/** Erasure only. Never authenticates, restores drafts, or authorizes a SEND. */
export async function eraseSessionOutbox(origin: string, session: Session): Promise<void> {
  revokeChatOutboxes(session.accountPartition, session.csrfToken);
  const environment = outboxEnvironment(origin);
  await DurableOutbox.revokeSession(environment, session.accountPartition, await outboxSessionKey(environment, session.csrfToken));
}
export async function erasePendingOutbox(origin: string, digest: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('INVALID_CLEANUP_BINDING');
  await DurableOutbox.revokeSessionKey(outboxEnvironment(origin), digest);
}
