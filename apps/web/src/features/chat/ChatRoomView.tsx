'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Info, WifiOff } from 'lucide-react';

import { Badge } from '@/shared/ui/badge';
import { cn } from '@/shared/lib/cn';

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
 * per-fan message query and the "DM으로 전환" room creation. The streamer now picks
 * SHARED or one of the harness-authorized PRIVATE recipients inside the same timeline.
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
  roomName: string;
  viewer: ChatActorRef;
  viewerRole: ChatViewerRole;
  items: ChatTimelineItem[];
  /** FAN only: the server-authorized streamer recipient. `null`/absent locks the composer. */
  fanRecipient?: ChatActorRef | null | undefined;
  /** STREAMER only: fans the server authorized for PRIVATE replies. SHARED is always available. */
  streamerRecipients?: readonly ChatActorRef[] | undefined;
  initialTarget?: ChatComposerTarget | undefined;
  /** Absent means sending is not wired yet; the composer says so instead of pretending. */
  onSubmit?: ((submission: ChatComposerSubmission) => ChatSubmitResult | Promise<ChatSubmitResult>) | undefined;
  onLoadOlder?: (() => void | Promise<void>) | undefined;
  hasOlder?: boolean | undefined;
  isLoadingOlder?: boolean | undefined;
  /** Short connection/recovery text, e.g. "연결을 다시 시도하는 중". */
  connectionNotice?: string | undefined;
  /** Banner text for preview screens, e.g. "미리보기 화면입니다. 실제 계정과 연결되지 않았습니다." */
  previewNotice?: string | undefined;
  className?: string | undefined;
}

export function ChatRoomView(props: ChatRoomViewProps) {
  // Remount on scope change: every piece of UI state below belongs to exactly one scope.
  return <ScopedChatRoom key={props.conversationScopeKey} {...props} />;
}

const EMPTY_RECIPIENTS: readonly ChatActorRef[] = [];

function ScopedChatRoom({
  conversationScopeKey,
  roomName,
  viewer,
  viewerRole,
  items,
  fanRecipient = null,
  streamerRecipients = EMPTY_RECIPIENTS,
  initialTarget,
  onSubmit,
  onLoadOlder,
  hasOlder,
  isLoadingOlder,
  connectionNotice,
  previewNotice,
  className,
}: ChatRoomViewProps) {
  const authorization = useMemo(
    () => ({ viewerRole, fanRecipient, streamerRecipients }),
    [viewerRole, fanRecipient, streamerRecipients],
  );

  const targetOptions = useMemo<ChatComposerTarget[]>(() => {
    if (viewerRole === 'FAN') {
      return fanRecipient ? [{ scope: 'PRIVATE', recipient: fanRecipient }] : [];
    }
    return [{ scope: 'SHARED' }, ...streamerRecipients.map<ChatComposerTarget>((recipient) => ({ scope: 'PRIVATE', recipient }))];
  }, [viewerRole, fanRecipient, streamerRecipients]);

  const [requestedTarget, setRequestedTarget] = useState<ChatComposerTarget | null>(() => {
    if (initialTarget && isAuthorizedTarget(initialTarget, authorization)) return initialTarget;
    return targetOptions[0] ?? null;
  });
  const [drafts, setDrafts] = useState<ChatDrafts>({});
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

  // Until the user interacts, the target follows the first authorized option (a fan's
  // recipient may arrive after mount). Once committed by an interaction it is pinned:
  // a revoked or changed recipient then locks the composer and keeps the draft under the
  // same key. There is never a silent fallback to another target.
  const draftKeyTarget = requestedTarget ?? targetOptions[0] ?? null;
  const target = draftKeyTarget !== null && isAuthorizedTarget(draftKeyTarget, authorization) ? draftKeyTarget : null;

  const commitTarget = useCallback(() => {
    if (requestedTarget === null && draftKeyTarget !== null) setRequestedTarget(draftKeyTarget);
  }, [requestedTarget, draftKeyTarget]);

  const lockedReason = useMemo(() => {
    if (onSubmit === undefined) return '미리보기 화면에서는 메시지를 보낼 수 없습니다.';
    if (target !== null) return undefined;
    if (draftKeyTarget !== null) return '보낼 대상을 다시 확인하는 중입니다. 작성 중인 내용은 유지됩니다.';
    if (viewerRole === 'FAN') return '아직 메시지를 받을 스트리머가 확인되지 않았습니다. 잠시 후 다시 시도해 주세요.';
    return '보낼 대상이 없습니다.';
  }, [onSubmit, target, draftKeyTarget, viewerRole]);

  // A fan without a confirmed recipient has no draft at all; nothing falls back to the SHARED draft.
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
      setDrafts((prev) => writeDraft(prev, draftKeyTarget, { body: value }));
      setNoticeFor(currentKey, null);
    },
    [draftKeyTarget, currentKey, commitTarget, setNoticeFor],
  );

  const changeTarget = useCallback((next: ChatComposerTarget) => {
    setRequestedTarget(next);
  }, []);

  const handleTargetChange = useCallback(
    (next: ChatComposerTarget) => {
      if (!isAuthorizedTarget(next, authorization)) {
        if (currentKey) setNoticeFor(currentKey, { tone: 'error', text: '이 대상에게는 지금 메시지를 보낼 수 없습니다.' });
        return;
      }
      if (isSameTarget(next, requestedTarget)) return;
      changeTarget(next);
    },
    [authorization, requestedTarget, changeTarget, currentKey, setNoticeFor],
  );

  const handleCancelQuote = useCallback(() => {
    if (!draftKeyTarget || !currentKey) return;
    if (isSubmittingCurrent) {
      setNoticeFor(currentKey, { tone: 'info', text: '보내는 중에는 인용을 바꿀 수 없습니다.' });
      return;
    }
    setDrafts((prev) => writeDraft(prev, draftKeyTarget, { quote: null }));
  }, [draftKeyTarget, currentKey, isSubmittingCurrent, setNoticeFor]);

  const handleReplyPrivate = useCallback(
    (item: ChatMessageItemModel) => {
      const quote = { messageId: item.id, authorName: item.author.displayName, excerpt: truncateExcerpt(item.body) };

      if (viewerRole === 'FAN') {
        // Fans always write to the authorized streamer; a reply only attaches the quote.
        if (!draftKeyTarget || !currentKey) {
          setAnnouncement('답장할 대상이 확인되지 않아 인용할 수 없습니다.');
          return;
        }
        if (isSubmittingCurrent) {
          setNoticeFor(currentKey, { tone: 'info', text: '보내는 중에는 인용을 바꿀 수 없습니다.' });
          return;
        }
        commitTarget();
        setDrafts((prev) => writeDraft(prev, draftKeyTarget, { quote }));
        return;
      }

      const recipient = streamerRecipients.find((r) => r.actorId === item.author.actorId);
      if (!recipient) {
        if (currentKey) setNoticeFor(currentKey, { tone: 'error', text: `${item.author.displayName}님에게는 지금 개인 답장을 보낼 수 없습니다.` });
        return;
      }
      const next: ChatComposerTarget = { scope: 'PRIVATE', recipient };
      const nextKey = draftKeyFor(next);
      if (submittingKey === nextKey) {
        // The quote of a draft that is being sent must not change under the pending send.
        setNoticeFor(nextKey, { tone: 'info', text: '보내는 중에는 인용을 바꿀 수 없습니다.' });
        if (!isSameTarget(next, requestedTarget)) changeTarget(next);
        return;
      }
      if (!isSameTarget(next, requestedTarget)) changeTarget(next);
      setDrafts((prev) => writeDraft(prev, next, { quote }));
    },
    [viewerRole, draftKeyTarget, currentKey, isSubmittingCurrent, commitTarget, streamerRecipients, requestedTarget, changeTarget, submittingKey, setNoticeFor],
  );

  const handleSubmit = useCallback(() => {
    if (!onSubmit || target === null || currentKey === null) return;
    if (submittingKey !== null) {
      if (submittingKey !== currentKey) setNoticeFor(currentKey, { tone: 'info', text: '다른 메시지를 보내는 중입니다. 끝나면 다시 시도해 주세요.' });
      return;
    }
    const submittedDraft = readDraft(drafts, target);
    const body = submittedDraft.body.trim();
    if (!body) return;
    const quoteId = submittedDraft.quote?.messageId;
    const submission: ChatComposerSubmission = quoteId ? { target, body, quoteMessageId: quoteId } : { target, body };
    const submittedTarget = target;
    const submittedKey = currentKey;

    setSubmittingKey(submittedKey);
    setNoticeFor(submittedKey, null);
    void (async () => {
      let result: ChatSubmitResult;
      try {
        result = await onSubmit(submission);
      } catch {
        result = { accepted: false, reason: '전송 결과를 확인할 수 없습니다. 작성한 내용은 그대로 남아 있습니다.' };
      }
      if (!mountedRef.current) return;
      setSubmittingKey(null);

      if (result.accepted) {
        // Clear only the exact draft that was sent. Any other draft (or a changed one) stays.
        setDrafts((prev) => (prev[submittedKey] === submittedDraft ? clearDraft(prev, submittedTarget) : prev));
      }

      const resultNotice: ChatComposerNotice | null = result.accepted
        ? result.note
          ? { tone: 'info', text: result.note }
          : null
        : { tone: 'error', text: result.reason };
      if (resultNotice) setNoticeFor(submittedKey, resultNotice);

      // If the user moved to another target meanwhile, tell them where the result landed.
      if (currentKeyRef.current !== submittedKey) {
        const label = targetLabel(submittedTarget);
        setAnnouncement(
          result.accepted
            ? `${label}에게 보낸 메시지가 접수되었습니다.`
            : `${label}에게 보낸 메시지가 거부되었습니다. 해당 대상으로 돌아가면 이유와 작성 내용을 볼 수 있습니다.`,
        );
      }
    })();
  }, [onSubmit, target, currentKey, submittingKey, drafts, setNoticeFor]);

  const canReply = viewerRole === 'FAN' ? fanRecipient !== null : true;

  return (
    <section
      className={cn('flex h-full min-h-0 flex-col bg-canvas', className)}
      aria-label={`${roomName} 채팅`}
      data-testid="chat-room"
      data-scope-key={conversationScopeKey}
    >
      <header className="flex shrink-0 flex-col gap-2 border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="truncate text-[18px] font-semibold text-ink">{roomName}</h1>
          <div className="flex items-center gap-2 text-[14px] text-muted">
            <span className="truncate">{viewer.displayName}</span>
            <Badge variant={viewerRole === 'STREAMER' ? 'brand' : 'secondary'}>{viewerRole === 'STREAMER' ? '스트리머' : '팬'}</Badge>
          </div>
        </div>
        {previewNotice && (
          <p className="flex items-start gap-2 rounded-sm bg-surface-soft px-3 py-2 text-[13px] text-body" data-testid="chat-preview-notice">
            <Info className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" />
            <span>{previewNotice}</span>
          </p>
        )}
        {connectionNotice && (
          <p className="flex items-start gap-2 rounded-sm border border-line px-3 py-2 text-[13px] text-body" role="status" data-testid="chat-connection-notice">
            <WifiOff className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" />
            <span>{connectionNotice}</span>
          </p>
        )}
      </header>

      <ChatTimeline
        items={items}
        viewerRole={viewerRole}
        onReplyPrivate={canReply ? handleReplyPrivate : undefined}
        onLoadOlder={onLoadOlder}
        hasOlder={hasOlder}
        isLoadingOlder={isLoadingOlder}
        ariaLabel={`${roomName} 메시지`}
      />

      <ChatComposer
        target={onSubmit ? target : null}
        lockedReason={lockedReason}
        value={draft.body}
        onChange={handleChange}
        onSubmit={handleSubmit}
        quote={draft.quote}
        onCancelQuote={handleCancelQuote}
        isSubmitting={isSubmittingCurrent}
        targetOptions={targetOptions}
        onTargetChange={handleTargetChange}
        notice={notice}
        announcement={announcement}
        disabled={onSubmit === undefined}
      />
    </section>
  );
}
