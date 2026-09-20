import type { ChatActorRef, ChatComposerTarget, ChatQuotePreview } from './types';

/**
 * Scoped composer drafts. A SHARED draft and each PRIVATE recipient's draft live
 * separately so switching the target never mixes or loses text. Pure helpers; the
 * component owns the state. Nothing here persists to storage.
 */

export type ChatDraftKey = 'shared' | `private:${string}`;

export interface ChatDraft {
  body: string;
  quote: ChatQuotePreview | null;
  retryCommandId?: string | undefined;
}

export type ChatDrafts = Readonly<Record<string, ChatDraft>>;

export const EMPTY_DRAFT: ChatDraft = { body: '', quote: null };

export function draftKeyFor(target: ChatComposerTarget): ChatDraftKey {
  return target.scope === 'SHARED' ? 'shared' : `private:${target.recipient.actorId}`;
}

export function readDraft(drafts: ChatDrafts, target: ChatComposerTarget): ChatDraft {
  return drafts[draftKeyFor(target)] ?? EMPTY_DRAFT;
}

export function writeDraft(drafts: ChatDrafts, target: ChatComposerTarget, patch: Partial<ChatDraft>): ChatDrafts {
  const key = draftKeyFor(target);
  const current = drafts[key] ?? EMPTY_DRAFT;
  return { ...drafts, [key]: { ...current, ...patch } };
}

export function clearDraft(drafts: ChatDrafts, target: ChatComposerTarget): ChatDrafts {
  const key = draftKeyFor(target);
  if (!(key in drafts)) return drafts;
  const next = { ...drafts };
  delete next[key];
  return next;
}

export function isSameTarget(a: ChatComposerTarget | null, b: ChatComposerTarget | null): boolean {
  if (a === null || b === null) return a === b;
  return draftKeyFor(a) === draftKeyFor(b);
}

/**
 * The composer may only target what the harness authorized:
 * - FAN: exactly the provided streamer recipient (PRIVATE only, never SHARED).
 * - STREAMER: SHARED, or one of the provided fan recipients.
 * A stale target (recipient no longer authorized) is rejected; the caller keeps the draft.
 */
export function isAuthorizedTarget(
  target: ChatComposerTarget,
  options: { viewerRole: 'FAN' | 'STREAMER'; fanRecipient: ChatActorRef | null; fanRecipients?: readonly ChatActorRef[]; streamerRecipients: readonly ChatActorRef[] },
): boolean {
  if (options.viewerRole === 'FAN') {
    return (
      target.scope === 'PRIVATE' &&
      (options.fanRecipients ?? (options.fanRecipient ? [options.fanRecipient] : [])).some(recipient => recipient.actorId === target.recipient.actorId)
    );
  }
  if (target.scope === 'SHARED') return true;
  return options.streamerRecipients.some((r) => r.actorId === target.recipient.actorId);
}

export function targetLabel(target: ChatComposerTarget | null): string {
  if (target === null) return '보낼 대상 없음';
  if (target.scope === 'SHARED') return '전체 참여자';
  return `${target.recipient.displayName}님에게만`;
}
