'use client';


import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus, Plus, Smile, Video } from 'lucide-react';
import { Popover } from 'radix-ui';

import { Button } from '@/shared/ui/button';
import { useMediaScope } from '@/features/media/session-ui';
import { PhotoDraftComposer } from './ChatMedia';
import { StickerPicker } from './StickerPicker';
import { cn } from '@/shared/lib/cn';

import type { ComposerStore } from './chat-memory';
import { ChatComposer } from './ChatComposer';
import type { ChatComposerNotice } from './ChatComposer';
import { ChatTimeline } from './ChatTimeline';
import { EMPTY_DRAFT, clearDraft, draftKeyFor, isAuthorizedTarget, isSameTarget, readDraft, targetLabel, writeDraft } from './drafts';
import type { ChatDraftKey, ChatDrafts } from './drafts';
import { truncateExcerpt } from './formatters';
import type {
  ChatActorRef,
  ChatComposerSubmission,
  ChatComposerTarget,
  ChatMessageItemModel,
  ChatOutgoingMessage,
  ChatSubmitResult,
  ChatTimelineItem,
  ChatViewerRole,
} from './types';

/**
 * Single-timeline chat room for fans and the streamer.
 *
 * Replaces meloming-front 8db1289e6ce5b2b37028ddbb73863363870de6b5
 * src/domains/talk/components/room/TalkStreamerView.tsx. From the original only the
 * composition "header + TalkMessageList + TalkMessageInput" and the reply/quote hand-off
 * survive. Removed: feed/fan-filter tabs, the fan list derived from loaded messages, the
 * per-fan message query and the "DM으로 전환" room creation. Fans write to the
 * room owner; a streamer writes to the room or privately replies to a selected message.
 *
 * This component owns UI state only: scoped drafts, quote, current target, per-target
 * result notices. It never sends, authenticates or persists; the harness does that through
 * `onSubmit`. All of that state is keyed by `conversationScopeKey`, so a different room or
 * viewer starts from a clean slate and a late `onSubmit` result from a previous scope is dropped.
 *
 * Send lifecycle: one submission in flight at a time. While it is pending, the submitted
 * target's draft is frozen (read-only input, quote changes blocked) and other targets stay
 * editable. When the result arrives, only the submitted draft is cleared, and only if it is
 * still the exact draft that was sent. A rejection keeps the draft and stores its notice under
 * that target, so switching back shows the reason; a polite, target-labelled announcement is
 * also made when the result belongs to a target the user is no longer looking at.
 */

export interface ChatRoomViewProps {
  /**
   * Opaque key for "this room as seen by this viewer" (room + account + participation scope).
   * Changing it resets drafts, quote, target, notices and scroll position.
   */
  conversationScopeKey: string;
  composerMemory?: ComposerStore | undefined;
  composerEpoch?: number | undefined;
  roomName: string;
  viewer: ChatActorRef;
  viewerRole: ChatViewerRole;
  items: ChatTimelineItem[];
  outgoing?: readonly ChatOutgoingMessage[] | undefined;
  onRetryOutgoing?: ((id: string) => void | Promise<void>) | undefined;
  outgoingBusy?: boolean | undefined;
  /** STREAMER only: fans the server authorized for PRIVATE replies. */
  streamerRecipients?: readonly ChatActorRef[] | undefined;
  /** Absent means sending is not wired yet; the composer says so instead of pretending. */
  onSubmit?: ((submission: ChatComposerSubmission) => ChatSubmitResult | Promise<ChatSubmitResult>) | undefined;
  submitBlockedReason?: string | undefined;
  submitBusy?: boolean | undefined;
  onDelete?: ((messageId: string) => Promise<ChatSubmitResult>) | undefined;
  actionNotice?: string | undefined;
  onLoadOlder?: (() => void | Promise<void>) | undefined;
  hasOlder?: boolean | undefined;
  historyCursor?: string | null | undefined;
  isLoadingOlder?: boolean | undefined;
  firstUnreadMessageId?: string | null | undefined;
  onVisibleMessage?: ((messageId: string) => void) | undefined;
  className?: string | undefined;
}

export function ChatRoomView(props: ChatRoomViewProps) {
  // Remount on scope change: every piece of UI state below belongs to exactly one scope.
  return <ScopedChatRoom key={props.conversationScopeKey} {...props} />;
}

const EMPTY_RECIPIENTS: readonly ChatActorRef[] = [];
const SHARED_TARGET: ChatComposerTarget = { scope: 'SHARED' };
const ROOM_OWNER_TARGET: ChatComposerTarget = { scope: 'ROOM_OWNER' };

function ScopedChatRoom({
  conversationScopeKey,
  composerMemory, composerEpoch,
  roomName,
  viewerRole,
  items,
  firstUnreadMessageId,
  onVisibleMessage,
  outgoing = [], onRetryOutgoing, outgoingBusy = false,
  streamerRecipients = EMPTY_RECIPIENTS,
  onSubmit,
  submitBlockedReason,
  submitBusy = false,
  onLoadOlder,
  onDelete,
  actionNotice,
  hasOlder,
  historyCursor,
  isLoadingOlder,
  className,
}: ChatRoomViewProps) {
  const media = useMediaScope();
  const [photoTargets, setPhotoTargets] = useState<Record<string, ChatComposerTarget>>({});
  const [videoTarget, setVideoTarget] = useState<ChatComposerTarget | null>(null);
  const [stickerTarget, setStickerTarget] = useState<ChatComposerTarget | null>(null);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const authorization = useMemo(
    () => ({ viewerRole, streamerRecipients }),
    [viewerRole, streamerRecipients],
  );
  const defaultTarget = viewerRole === 'FAN' ? ROOM_OWNER_TARGET : SHARED_TARGET;

  const [requestedTarget, setRequestedTarget] = useState<ChatComposerTarget | null>(() => {
    const parked = composerMemory?.getComposer().target;
    if (parked?.scope === 'PRIVATE' && composerMemory?.getComposer().drafts[draftKeyFor(parked)]?.quote && isAuthorizedTarget(parked, authorization)) return parked;
    return defaultTarget;
  });
  const [drafts, setDrafts] = useState<ChatDrafts>(() => composerMemory?.getComposer().drafts ?? {});
  // A resumed tab can receive a newer authorized quote while the composer stays
  // mounted. Refresh only the quote preview; preserve the user's typed body.
  const [observedItems, setObservedItems] = useState(items);
  if (observedItems !== items) {
    setObservedItems(items);
    const authoritative = composerMemory?.getComposer().drafts;
    if (authoritative) setDrafts(current => {
      let changed = false;
      const next = { ...current };
      for (const [key, draft] of Object.entries(current)) {
        const quote = authoritative[key]?.quote;
        if (!draft.quote || !quote || draft.quote.messageId !== quote.messageId ||
          (draft.quote.excerpt === quote.excerpt && draft.quote.authorName === quote.authorName)) continue;
        next[key] = { ...draft, quote }; changed = true;
      }
      return changed ? next : current;
    });
  }
  useLayoutEffect(() => { if (composerEpoch !== undefined) composerMemory?.saveComposer(drafts, requestedTarget, composerEpoch); }, [composerMemory, composerEpoch, drafts, requestedTarget]);
  /** Draft key whose send is pending, or null. */
  const [submittingKey, setSubmittingKey] = useState<ChatDraftKey | null>(null);
  /** Result/guidance per draft key, so a late result lands on the target it belongs to. */
  const [notices, setNotices] = useState<Readonly<Partial<Record<ChatDraftKey, ChatComposerNotice>>>>({});
  /** Polite, target-labelled announcement for a result that arrived for another target. */
  const [announcement, setAnnouncement] = useState('');

  // Scope-key remount unmounts this component; a resolving onSubmit from the old scope sees
  // mountedRef=false and does nothing.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!announcement) return;
    const timer = window.setTimeout(() => setAnnouncement(''), 6000);
    return () => window.clearTimeout(timer);
  }, [announcement]);

  // A reply only exists while it still has a selected source message. Revoked fan
  // authority locks the private draft; a removed quote returns to the role's default target.
  const draftKeyTarget = requestedTarget?.scope === 'PRIVATE' && !readDraft(drafts, requestedTarget).quote ? defaultTarget : requestedTarget ?? defaultTarget;
  const target = isAuthorizedTarget(draftKeyTarget, authorization) ? draftKeyTarget : null;

  const commitTarget = useCallback(() => {
    if (requestedTarget === null && draftKeyTarget !== null) setRequestedTarget(draftKeyTarget);
  }, [requestedTarget, draftKeyTarget]);

  const lockedReason = onSubmit === undefined
    ? '현재 메시지를 보낼 수 없습니다. 잠시 후 다시 확인해 주세요.'
    : target !== null ? undefined : '선택한 메시지에 지금 답장할 수 없습니다. 답장을 취소하거나 다시 선택해 주세요.';

  const currentKey: ChatDraftKey | null = draftKeyTarget ? draftKeyFor(draftKeyTarget) : null;
  const draft = draftKeyTarget ? readDraft(drafts, draftKeyTarget) : EMPTY_DRAFT;
  const notice = currentKey ? (notices[currentKey] ?? null) : null;
  const isSubmittingCurrent = submittingKey !== null && submittingKey === currentKey;

  // Latest visible draft key, read by the async send-result handler below.
  const currentKeyRef = useRef<ChatDraftKey | null>(currentKey);
  useEffect(() => {
    currentKeyRef.current = currentKey;
  }, [currentKey]);

  const setNoticeFor = useCallback((key: ChatDraftKey, next: ChatComposerNotice | null) => {
    setNotices((prev) => {
      if (next === null) {
        if (!(key in prev)) return prev;
        const copy = { ...prev };
        delete copy[key];
        return copy;
      }
      return { ...prev, [key]: next };
    });
  }, []);

  const handleChange = useCallback(
    (value: string) => {
      if (!draftKeyTarget || !currentKey) return;
      commitTarget();
      setDrafts((prev) => writeDraft(prev, draftKeyTarget, { body: value, retryCommandId: undefined }));
      setNoticeFor(currentKey, null);
    },
    [draftKeyTarget, currentKey, commitTarget, setNoticeFor],
  );

  const handleCancelQuote = useCallback(() => {
    if (!draftKeyTarget || !currentKey) return;
    if (isSubmittingCurrent) {
      setNoticeFor(currentKey, { tone: 'info', text: '보내는 중에는 인용을 바꿀 수 없습니다.' });
      return;
    }
    setDrafts((prev) => clearDraft(prev, draftKeyTarget));
    setRequestedTarget(defaultTarget);
  }, [draftKeyTarget, currentKey, isSubmittingCurrent, setNoticeFor, defaultTarget]);

  const handleReplyPrivate = useCallback(
    (item: ChatMessageItemModel) => {
      if (item.isOwn || !item.allowedActions?.reply) return;
      setAttachmentsOpen(false);
      const quote = { messageId: item.id, authorName: item.author.displayName, excerpt: truncateExcerpt(item.body) };

      if (viewerRole !== 'STREAMER') return;
      const recipient = streamerRecipients.find((r) => r.actorId === (item.scope === 'PRIVATE' ? item.counterpartActorId : item.author.actorId));
      if (!recipient) {
        if (currentKey) setNoticeFor(currentKey, { tone: 'error', text: `${item.recipient?.displayName ?? (item.isOwn ? '상대방' : item.author.displayName)}님에게는 지금 개인 답장을 보낼 수 없습니다.` });
        return;
      }
      const next: ChatComposerTarget = { scope: 'PRIVATE', recipient };
      const nextKey = draftKeyFor(next);
      if (submittingKey === nextKey) {
        // The quote of a draft that is being sent must not change under the pending send.
        setNoticeFor(nextKey, { tone: 'info', text: '보내는 중에는 인용을 바꿀 수 없습니다.' });
        if (!isSameTarget(next, requestedTarget)) setRequestedTarget(next);
        return;
      }
      if (!isSameTarget(next, requestedTarget)) setRequestedTarget(next);
      setDrafts((prev) => writeDraft(prev, next, { quote, retryCommandId: undefined }));
    },
    [viewerRole, currentKey, streamerRecipients, requestedTarget, submittingKey, setNoticeFor],
  );

  const handleSubmit = useCallback(() => {
    if (!onSubmit || submitBlockedReason || submitBusy || target === null || currentKey === null) return;
    if (submittingKey !== null) {
      if (submittingKey !== currentKey) setNoticeFor(currentKey, { tone: 'info', text: '다른 메시지를 보내는 중입니다. 끝나면 다시 시도해 주세요.' });
      return;
    }
    const submittedDraft = readDraft(drafts, target);
    const body = submittedDraft.body.trim();
    if (!body) return;
    const quoteId = submittedDraft.quote?.messageId;
    const submission: ChatComposerSubmission = quoteId ? { target, body, quoteMessageId: quoteId } : { target, body };
    if (submittedDraft.retryCommandId) submission.retryCommandId = submittedDraft.retryCommandId;
    const submittedTarget = target;
    const submittedKey = currentKey;

    setSubmittingKey(submittedKey);
    setNoticeFor(submittedKey, null);
    void (async () => {
      let result: ChatSubmitResult;
      try {
        result = await onSubmit(submission);
      } catch {
        result = { accepted: false, reason: '메시지를 보냈는지 확인할 수 없어요. 작성 중인 내용은 남아 있어요.' };
      }
      if (!mountedRef.current) return;
      setSubmittingKey(null);

      if (result.accepted || (!result.accepted && result.pendingDelivery)) {
        // Clear only the exact draft that was sent. Any other draft (or a changed one) stays.
        setDrafts((prev) => (prev[submittedKey] === submittedDraft ? clearDraft(prev, submittedTarget) : prev));
        if (submittedTarget.scope === 'PRIVATE' && currentKeyRef.current === submittedKey) setRequestedTarget(defaultTarget);
      }

      if (!result.accepted && result.retryCommandId && !result.pendingDelivery) {
        const retryCommandId = result.retryCommandId;
        setDrafts(prev => prev[submittedKey] === submittedDraft ? writeDraft(prev, submittedTarget, { retryCommandId }) : prev);
      }

      const resultNotice: ChatComposerNotice | null = result.accepted
        ? result.note
          ? { tone: 'info', text: result.note }
          : null
        : result.pendingDelivery ? null : { tone: 'error', text: result.reason };
      if (resultNotice) setNoticeFor(submittedKey, resultNotice);

      // If the user moved to another target meanwhile, tell them where the result landed.
      if (currentKeyRef.current !== submittedKey && (result.accepted || !result.pendingDelivery)) {
        const label = targetLabel(submittedTarget);
        setAnnouncement(
          result.accepted
            ? `${label}에게 보낸 메시지가 접수되었습니다.`
            : `${label}에게 메시지를 보내지 못했어요. 작성한 메시지를 확인해 주세요.`,
        );
      }
    })();
  }, [onSubmit, submitBlockedReason, submitBusy, target, currentKey, submittingKey, drafts, setNoticeFor, defaultTarget]);

  const canReply = viewerRole === 'STREAMER' && streamerRecipients.length > 0;
  // Media commands do not carry a source message, so attachments use the role's ordinary target.
  const attachmentAction = onSubmit && target?.scope === defaultTarget.scope && media?.configured ? (
    <Popover.Root open={attachmentsOpen} onOpenChange={setAttachmentsOpen}>
      <Popover.Trigger asChild>
        <Button type="button" variant="ghost" size="icon" className="rounded-full text-chat-accent hover:bg-surface-soft" aria-label="첨부 메뉴 열기" aria-expanded={attachmentsOpen}>
          <Plus className="size-6" aria-hidden="true" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="start" sideOffset={8} className="z-50 w-44 rounded-xl border border-line bg-canvas p-1.5 shadow-lg" aria-label="첨부 메뉴">
          <button type="button" className="flex min-h-11 w-full items-center gap-3 rounded-sm px-3 text-left text-sm text-ink hover:bg-surface-soft" disabled={Object.keys(photoTargets).length >= 2 && !photoTargets[draftKeyFor(target)]} onClick={() => {
            commitTarget(); setPhotoTargets(previous => previous[draftKeyFor(target)] || Object.keys(previous).length < 2 ? { ...previous, [draftKeyFor(target)]: target } : previous); setAttachmentsOpen(false);
          }}><ImagePlus className="size-5 text-chat-accent" aria-hidden="true" />사진 첨부</button>
          <button type="button" className="flex min-h-11 w-full items-center gap-3 rounded-sm px-3 text-left text-sm text-ink hover:bg-surface-soft" onClick={() => {
            commitTarget(); setStickerTarget(target); setAttachmentsOpen(false);
          }}><Smile className="size-5 text-chat-accent" aria-hidden="true" />스티커 선택</button>
          <button type="button" className="flex min-h-11 w-full items-center gap-3 rounded-sm px-3 text-left text-sm text-ink hover:bg-surface-soft" onClick={() => {
            commitTarget(); setVideoTarget(target); setAttachmentsOpen(false);
          }}><Video className="size-5 text-chat-accent" aria-hidden="true" />영상 첨부</button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  ) : null;

  return (
    <section
      className={cn('flex h-full min-h-0 flex-col bg-canvas', className)}
      aria-label={`${roomName} 채팅`}
      data-testid="chat-room"
      data-scope-key={conversationScopeKey}
    >
      <h1 className="sr-only md:hidden">{roomName} 채팅</h1>
      <header className="hidden shrink-0 flex-col gap-2 border-b border-line-subtle px-5 py-3 md:flex">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h1 className="truncate text-[18px] font-semibold text-ink">{roomName}</h1><p className="text-[12px] text-muted">{viewerRole === 'STREAMER' ? '팬과의 채팅' : '후로기와의 채팅'}</p></div>
        </div>
      </header>
      {actionNotice && <p role="status" className="shrink-0 border-b border-line-subtle px-4 py-1.5 text-[13px] text-muted">{actionNotice}</p>}

      <ChatTimeline
        items={items}
        firstUnreadMessageId={firstUnreadMessageId}
        onVisibleMessage={onVisibleMessage}
        outgoing={outgoing}
        onRetryOutgoing={onRetryOutgoing}
        outgoingBusy={outgoingBusy}
        viewerRole={viewerRole}
        onReplyPrivate={canReply ? handleReplyPrivate : undefined}
        onDelete={onDelete}
        onLoadOlder={onLoadOlder}
        hasOlder={hasOlder}
        historyPageKey={historyCursor}
        isLoadingOlder={isLoadingOlder}
        ariaLabel={`${roomName} 메시지`}
      />

      {onSubmit && videoTarget && isAuthorizedTarget(videoTarget, authorization) && <div className="max-h-[40dvh] overflow-y-auto" hidden={draftKeyFor(videoTarget) !== currentKey}>
        <PhotoDraftComposer key={`video:${draftKeyFor(videoTarget)}`} kind="VIDEO" target={videoTarget} onSubmit={onSubmit} submitBlocked={Boolean(submitBlockedReason || submitBusy)} onClose={() => setVideoTarget(null)} />
      </div>}
      {onSubmit && stickerTarget && isAuthorizedTarget(stickerTarget, authorization) && <div className="max-h-[40dvh] overflow-y-auto" hidden={draftKeyFor(stickerTarget) !== currentKey}>
        <StickerPicker key={draftKeyFor(stickerTarget)} target={stickerTarget} onSubmit={onSubmit} submitBlocked={Boolean(submitBlockedReason || submitBusy)} onClose={() => setStickerTarget(null)} />
      </div>}
      {onSubmit && Object.entries(photoTargets).filter(([, value]) => isAuthorizedTarget(value, authorization)).map(([key, value]) => <div key={key} hidden={key !== currentKey} className="max-h-[40dvh] overflow-y-auto">
        <PhotoDraftComposer target={value} onSubmit={onSubmit} submitBlocked={Boolean(submitBlockedReason || submitBusy)} onClose={() => setPhotoTargets(previous => {
          const next = { ...previous }; delete next[key]; return next;
        })} />
      </div>)}

      <ChatComposer
        target={onSubmit ? target : null}
        lockedReason={lockedReason}
        value={draft.body}
        onChange={handleChange}
        onSubmit={handleSubmit}
        quote={draft.quote}
        onCancelQuote={handleCancelQuote}
        isSubmitting={isSubmittingCurrent}
        notice={notice}
        announcement={announcement}
        disabled={onSubmit === undefined}
        submitBlockedReason={submitBlockedReason}
        submitBlocked={submitBusy}
        attachmentAction={attachmentAction}
      />
    </section>
  );
}
