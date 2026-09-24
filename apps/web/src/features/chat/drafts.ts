import type { ChatActorRef, ChatComposerTarget, ChatQuotePreview } from './types';

/**
 * Scoped composer drafts. A SHARED draft and each PRIVATE recipient's draft live
 * separately so switching the target never mixes or loses text. Pure helpers; the
 * component owns the state. Nothing here persists to storage.
 */

export type ChatDraftKey = 'shared' | 'room-owner' | `private:${string}`;

export interface ChatDraft {
  body: string;
  quote: ChatQuotePreview | null;
  retryCommandId?: string | undefined;
}

export type ChatDrafts = Readonly<Record<string, ChatDraft>>;

export const EMPTY_DRAFT: ChatDraft = { body: '', quote: null };

export function draftKeyFor(target: ChatComposerTarget): ChatDraftKey {
  return target.scope === 'SHARED' ? 'shared' : target.scope === 'ROOM_OWNER' ? 'room-owner' : `private:${target.recipient.actorId}`;
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
 * - Everyone: SHARED.
 * - STREAMER: a server-authorized fan when replying to a selected message.
 * A stale target (recipient no longer authorized) is rejected; the caller keeps the draft.
 */
export function isAuthorizedTarget(
  target: ChatComposerTarget,
  options: { viewerRole: 'FAN' | 'STREAMER'; streamerRecipients: readonly ChatActorRef[] },
): boolean {
  if (target.scope === 'SHARED') return true;
  if (target.scope === 'ROOM_OWNER' || options.viewerRole === 'FAN') return false;
  return options.streamerRecipients.some((r) => r.actorId === target.recipient.actorId);
}

export function targetLabel(target: ChatComposerTarget | null): string {
  if (target === null) return '보낼 대상 없음';
  if (target.scope === 'SHARED') return '전체 참여자';
  if (target.scope === 'ROOM_OWNER') return '방장에게만';
  return `${target.recipient.displayName}님에게만`;
}
