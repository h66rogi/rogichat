/**
 * Presentation-only models for the 로기챗 chat screen.
 *
 * These types describe what the UI needs to render and nothing more. They are not
 * server DTOs: the live REST sync controller projects real data into this shape. Fans only ever receive SHARED
 * items and their own PRIVATE conversation; that projection happens before this layer.
 */

export type ChatScope = 'SHARED' | 'PRIVATE';

export type ChatViewerRole = 'FAN' | 'STREAMER';

/** A participant reference the UI may show. Never derived from nicknames or message authors. */
export interface ChatActorRef {
  actorId: string;
  displayName: string;
  avatarUrl: string | null;
  role?: ChatViewerRole | undefined;
}

/**
 * pending  — accepted locally, not yet confirmed saved.
 * saved    — the server confirmed storage (not the same as "read").
 * unknown  — the result of the send is not known yet (ACK lost, checking).
 * rejected — the server refused it; the author can fix and resend.
 * deleted  — body removed; rendered as a tombstone.
 */
export type ChatMessageStatus = 'pending' | 'saved' | 'unknown' | 'rejected' | 'deleted';

/** Compact quote shown above a message or in the composer. Only authored messages can be quoted. */
export interface ChatQuotePreview {
  messageId: string;
  authorName: string;
  excerpt: string;
}

export interface ChatMessageItemModel {
  kind: 'message';
  counterpartActorId?: string | null;
  allowedActions?: { reply: boolean; publish: boolean; delete: boolean };
  id: string;
  scope: ChatScope;
  author: ChatActorRef;
  /** Present for PRIVATE messages so the UI can always name the other side. */
  recipient?: ChatActorRef;
  isOwn: boolean;
  body: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
  status: ChatMessageStatus;
  /** Short, user-facing explanation for `rejected` / `unknown` states. */
  statusNote?: string;
  quote?: ChatQuotePreview;
}

/**
 * A message the streamer published to the whole room from a private conversation.
 * It is an independent item on purpose: no author, no link to the original message.
 */
export interface ChatPublicationItemModel {
  kind: 'publication';
  allowedActions?: { reply: boolean; publish: boolean; delete: boolean };
  id: string;
  body: string;
  createdAt: string;
}

/** Content the client cannot render yet. Shown as a safe placeholder, never as raw data. */
export interface ChatUnsupportedItemModel {
  kind: 'unsupported';
  allowedActions?: { reply: boolean; publish: boolean; delete: boolean };
  id: string;
  scope: ChatScope;
  createdAt: string;
}

export type ChatTimelineItem = ChatMessageItemModel | ChatPublicationItemModel | ChatUnsupportedItemModel;

export type ChatComposerTarget = { scope: 'SHARED' } | { scope: 'PRIVATE'; recipient: ChatActorRef };

export interface ChatComposerSubmission {
  target: ChatComposerTarget;
  body: string;
  quoteMessageId?: string;
  retryCommandId?: string;
}

/** Returned by the controller `onSubmit`. On `accepted: false` the composer keeps the draft. */
export type ChatSubmitResult = { accepted: true; note?: string } | { accepted: false; reason: string; retryCommandId?: string };
