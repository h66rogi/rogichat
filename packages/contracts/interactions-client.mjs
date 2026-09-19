// Gesture enters a draft only. No network call, auto-send, guessed fan identity or shared fallback.
export function privateReplyDraft({ direction, roomId, ownActorId, targetActorId, quoteId = null }) {
  if (direction !== 'right-to-left' || !targetActorId || targetActorId === ownActorId) return null;
  return Object.freeze({ roomId, intent: 'PRIVATE', recipientActorId: targetActorId, quoteId, text: '', error: null });
}
export function privateReplyCommand(draft, clientMessageId) {
  if (draft.intent !== 'PRIVATE' || !draft.recipientActorId || !draft.text.trim()) throw new Error('invalid_private_draft');
  return { clientMessageId, intent: 'PRIVATE', recipientActorId: draft.recipientActorId,
    ...(draft.quoteId ? { quoteId: draft.quoteId } : {}), content: { type: 'TEXT', text: draft.text } };
}
export function failedPrivateReply(draft, status) {
  return { ...draft, error: [403, 404].includes(status) ? 'recipient_unavailable' : 'retry_same_command' };
}
// Aggregate reactions are separate viewer-authorized resources. Refresh on every new
// message version; never infer reactor identities from message events or socket hints.
export function reactionRefreshTargets(events) {
  return [...new Set(events.filter(event => event.type === 'message.upsert').map(event => event.message.id))];
}
