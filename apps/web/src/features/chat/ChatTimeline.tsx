'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronUp, CircleAlert, LoaderCircle } from 'lucide-react';

import { Button } from '@/shared/ui/button';
import { cn } from '@/shared/lib/cn';

import { ChatMessageItem } from './ChatMessageItem';
import { formatDateLabel, isSameDay, parseIsoDate, truncateExcerpt } from './formatters';
import type { ChatMessageItemModel, ChatOutgoingMessage, ChatTimelineItem, ChatViewerRole, ChatSubmitResult } from './types';

/**
 * Scrollable message timeline with date separators.
 *
 * Adapted from meloming-front 8db1289e6ce5b2b37028ddbb73863363870de6b5
 * src/domains/talk/components/room/TalkMessageList.tsx: kept the date grouping, the
 * "load older" affordance at the top, and the newest-key comparison idea for tail
 * detection. Fixed: history prepend is anchored to the first visible item + offset
 * (the original relied on browser scroll anchoring and scrolled to the bottom whenever
 * the newest key changed, even while reading older history); the scroll-to-top
 * auto-load no longer fires on mount when the list is shorter than the viewport;
 * removed numeric IDs, read receipts, reactions and emoticon maps. Added a minimal
 * live region that announces only newly appended items and a "jump to new" button.
 */

export interface ChatTimelineProps {
  items: ChatTimelineItem[];
  outgoing?: readonly ChatOutgoingMessage[] | undefined;
  onRetryOutgoing?: ((id: string) => void | Promise<void>) | undefined;
  outgoingBusy?: boolean | undefined;
  viewerRole: ChatViewerRole;
  onDelete?: ((messageId: string) => Promise<ChatSubmitResult>) | undefined;
  onReplyPrivate?: ((item: ChatMessageItemModel) => void) | undefined;
  onLoadOlder?: (() => void | Promise<void>) | undefined;
  hasOlder?: boolean | undefined;
  historyPageKey?: string | null | undefined;
  isLoadingOlder?: boolean | undefined;
  firstUnreadMessageId?: string | null | undefined;
  onVisibleMessage?: ((messageId: string) => void) | undefined;
  ariaLabel?: string | undefined;
  className?: string | undefined;
}

type Entry = { type: 'separator'; key: string; label: string } | { type: 'item'; item: ChatTimelineItem };

const BOTTOM_THRESHOLD_PX = 32;
const TOP_LOAD_THRESHOLD_PX = 80;

export function ChatTimeline({
  items,
  outgoing = [], onRetryOutgoing, outgoingBusy = false,
  viewerRole,
  onReplyPrivate,
  onDelete,
  onLoadOlder,
  hasOlder = false,
  historyPageKey = null,
  isLoadingOlder = false,
  firstUnreadMessageId = null,
  onVisibleMessage,
  ariaLabel = '채팅 메시지',
  className,
}: ChatTimelineProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<{ id: string; offset: number } | null>(null);
  const wasAtBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const prevItemsRef = useRef<ChatTimelineItem[] | null>(null);
  const previousOutgoingRef = useRef<readonly string[] | null>(null);
  const userMovedRef = useRef(false);
  const positionedUnreadRef = useRef<string | null>(null);
  const attemptedUnreadPageRef = useRef<string | null>(null);
  const attemptedQuotePageRef = useRef<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [unseenCount, setUnseenCount] = useState(0);
  const [showLatest, setShowLatest] = useState(false);
  const [quoteTarget, setQuoteTarget] = useState<string | null>(null);
  const [quoteNotice, setQuoteNotice] = useState('');

  const navigateQuote = useCallback((messageId: string) => {
    userMovedRef.current = true;
    attemptedQuotePageRef.current = null;
    setQuoteNotice('');
    setQuoteTarget(messageId);
  }, []);

  useEffect(() => {
    if (!quoteTarget || isLoadingOlder) return;
    const row = [...(viewportRef.current?.querySelectorAll<HTMLElement>('[data-item-id]') ?? [])]
      .find(item => item.dataset.itemId === quoteTarget);
    if (row) {
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      row.focus({ preventScroll: true });
      // The DOM row exists only after the requested history page has committed.
      setQuoteTarget(null);
    } else if (hasOlder && onLoadOlder) {
      const pageKey = `${quoteTarget}:${historyPageKey ?? ''}`;
      if (attemptedQuotePageRef.current === pageKey) return;
      attemptedQuotePageRef.current = pageKey;
      void onLoadOlder();
    } else {
      // Exhausted history is known only after checking the newly rendered rows.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuoteNotice('원본 메시지가 현재 볼 수 있는 기록에 없습니다.');
      setQuoteTarget(null);
    }
  }, [quoteTarget, items, hasOlder, historyPageKey, isLoadingOlder, onLoadOlder]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior) => {
    const el = viewportRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    wasAtBottomRef.current = true;
    setUnseenCount(0);
    setShowLatest(false);
  }, []);

  // Record the first visible item and its offset so a history prepend can restore it.
  const recordAnchor = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const rows = el.querySelectorAll<HTMLElement>('[data-item-id]');
    const top = el.scrollTop;
    for (const row of rows) {
      if (row.offsetTop + row.offsetHeight > top) {
        anchorRef.current = { id: row.dataset.itemId ?? '', offset: row.offsetTop - top };
        break;
      }
    }
    wasAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD_PX;
    setShowLatest(!wasAtBottomRef.current);
    if (wasAtBottomRef.current) setUnseenCount(0);
  }, []);

  const reportVisible = useCallback(() => {
    const el = viewportRef.current;
    if (!el || !onVisibleMessage) return;
    if (firstUnreadMessageId && positionedUnreadRef.current !== firstUnreadMessageId && !userMovedRef.current) return;
    const viewport = el.getBoundingClientRect();
    const unreadIndex = firstUnreadMessageId && !userMovedRef.current
      ? items.findIndex(item => item.id === firstUnreadMessageId) : -1;
    for (const row of el.querySelectorAll<HTMLElement>('[data-item-id]')) {
      const id = row.dataset.itemId;
      if (!id) continue;
      const index = items.findIndex(item => item.id === id);
      if (index < 0 || (unreadIndex >= 0 && index < unreadIndex)) continue;
      const box = row.getBoundingClientRect();
      if (box.top < viewport.bottom && box.bottom > viewport.top) onVisibleMessage(id);
    }
  }, [items, firstUnreadMessageId, onVisibleMessage]);

  const handleScroll = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const previousTop = lastScrollTopRef.current;
    lastScrollTopRef.current = el.scrollTop;
    recordAnchor();
    reportVisible();

    const scrollingUp = el.scrollTop < previousTop;
    const overflows = el.scrollHeight > el.clientHeight;
    if (scrollingUp && overflows && hasOlder && !isLoadingOlder && onLoadOlder && el.scrollTop < TOP_LOAD_THRESHOLD_PX) {
      void onLoadOlder();
    }
  }, [hasOlder, isLoadingOlder, onLoadOlder, recordAnchor, reportVisible]);

  useEffect(() => {
    const frame = requestAnimationFrame(reportVisible);
    return () => cancelAnimationFrame(frame);
  }, [items, firstUnreadMessageId, reportVisible]);

  useEffect(() => {
    if (!firstUnreadMessageId || positionedUnreadRef.current === firstUnreadMessageId ||
      userMovedRef.current || items.some(item => item.id === firstUnreadMessageId) ||
      !hasOlder || isLoadingOlder || !onLoadOlder) return;
    const pageKey = `${firstUnreadMessageId}:${historyPageKey ?? ''}`;
    if (attemptedUnreadPageRef.current === pageKey) return;
    attemptedUnreadPageRef.current = pageKey;
    recordAnchor();
    void onLoadOlder();
  }, [firstUnreadMessageId, items, hasOlder, historyPageKey, isLoadingOlder, onLoadOlder, recordAnchor]);

  // Initial position: bottom, no animation.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    lastScrollTopRef.current = el.scrollTop;
    wasAtBottomRef.current = true;
  }, []);

  // React to item changes: restore anchor on prepend, follow the tail only if we were at the bottom.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    const prev = prevItemsRef.current;
    prevItemsRef.current = items;
    if (!el || prev === null) return;

    const prevFirst = prev[0];
    const prevLast = prev[prev.length - 1];
    const first = items[0];
    const last = items[items.length - 1];

    const prepended = prevFirst !== undefined && first !== undefined && prevFirst.id !== first.id && items.some((i) => i.id === prevFirst.id);
    const appended = last !== undefined && (prevLast === undefined || prevLast.id !== last.id) && (prevLast === undefined || items.some((i) => i.id === prevLast.id));

    if (prepended) {
      const anchor = anchorRef.current;
      const target = anchor ? el.querySelector<HTMLElement>(`[data-item-id="${cssEscape(anchor.id)}"]`) : null;
      if (target && anchor) {
        el.scrollTop = target.offsetTop - anchor.offset;
        lastScrollTopRef.current = el.scrollTop;
      }
    }

    if (appended) {
      const newTail = tailAfter(prev, items);
      const ownTail = newTail.every((i) => i.kind === 'message' && i.isOwn);
      if (wasAtBottomRef.current || ownTail) {
        scrollToBottom('auto');
      } else {
        setUnseenCount((n) => n + newTail.length);
      }
      const announceable = newTail.filter((i) => !(i.kind === 'message' && i.isOwn));
      if (announceable.length > 0) setAnnouncement(announcementFor(announceable));
    }
  }, [items, scrollToBottom]);

  // Place the first unread row before visibility reporting can advance the read position.
  useLayoutEffect(() => {
    if (!firstUnreadMessageId || positionedUnreadRef.current === firstUnreadMessageId || userMovedRef.current) return;
    const el = viewportRef.current;
    const row = el?.querySelector<HTMLElement>(`[data-item-id="${cssEscape(firstUnreadMessageId)}"]`);
    if (el && row) {
      el.scrollTop = Math.max(0, row.offsetTop - 8);
      lastScrollTopRef.current = el.scrollTop;
      wasAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD_PX;
      setShowLatest(!wasAtBottomRef.current);
      positionedUnreadRef.current = firstUnreadMessageId;
    } else if (!hasOlder && !isLoadingOlder) {
      positionedUnreadRef.current = firstUnreadMessageId;
    }
  }, [firstUnreadMessageId, items, hasOlder, isLoadingOlder]);

  useLayoutEffect(() => {
    const ids = outgoing.map(item => item.id);
    const previous = previousOutgoingRef.current;
    previousOutgoingRef.current = ids;
    if (previous && ids.some(id => !previous.includes(id))) scrollToBottom('auto');
  }, [outgoing, scrollToBottom]);

  // Clear the announcement so the same text can be re-announced later.
  useEffect(() => {
    if (!announcement) return;
    const timer = window.setTimeout(() => setAnnouncement(''), 4000);
    return () => window.clearTimeout(timer);
  }, [announcement]);

  const entries = buildEntries(items);

  return (
    <div className={cn('relative flex min-h-0 flex-1 flex-col', className)}>
      {/* Focusable region so keyboard users can scroll the history even when no row contains a control. */}
      <div
        ref={viewportRef}
        onScroll={handleScroll}
        onWheel={() => { userMovedRef.current = true; }}
        onTouchStart={() => { userMovedRef.current = true; }}
        onKeyDown={(event) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) userMovedRef.current = true; }}
        role="region"
        aria-label={ariaLabel}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring"
        data-testid="chat-timeline"
      >
        {quoteNotice && <p role="status" className="sticky top-0 z-10 bg-surface-soft px-4 py-2 text-sm text-body">{quoteNotice}</p>}
        <ol className="flex min-h-full flex-col py-2">
          {(hasOlder || isLoadingOlder) && (
            <li className="flex justify-center py-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => { userMovedRef.current = true; void onLoadOlder?.(); }}
                disabled={isLoadingOlder || !onLoadOlder}
                aria-busy={isLoadingOlder}
                data-testid="chat-load-older"
              >
                {isLoadingOlder ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <ChevronUp className="size-4" aria-hidden="true" />}
                {isLoadingOlder ? '이전 메시지를 불러오는 중' : '이전 메시지 보기'}
              </Button>
            </li>
          )}

          {items.length === 0 && outgoing.length === 0 && (
            <li className="flex flex-1 items-center justify-center px-6 py-16 text-center text-[14px] text-muted">
              아직 메시지가 없습니다. 첫 메시지를 보내면 여기에 표시됩니다.
            </li>
          )}

          {entries.map((entry) =>
            entry.type === 'separator' ? (
              <li key={entry.key} className="flex items-center gap-3 px-4 py-3">
                <span className="h-px flex-1 bg-line-subtle" aria-hidden="true" />
                <span className="shrink-0 text-[12px] font-semibold text-muted">{entry.label}</span>
                <span className="h-px flex-1 bg-line-subtle" aria-hidden="true" />
              </li>
            ) : (
              <li key={entry.item.id} data-item-id={entry.item.id} data-testid="chat-timeline-item" tabIndex={-1} className="focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-chat-accent">
                {entry.item.id === firstUnreadMessageId && <div className="mx-4 my-2 flex items-center gap-3 text-xs font-semibold text-chat-accent" data-testid="chat-first-unread">
                  <span className="h-px flex-1 bg-chat-accent" aria-hidden="true" />여기부터 읽지 않은 메시지<span className="h-px flex-1 bg-chat-accent" aria-hidden="true" />
                </div>}
                <ChatMessageItem item={entry.item} viewerRole={viewerRole} onReplyPrivate={onReplyPrivate} onDelete={onDelete} onQuoteNavigate={navigateQuote} />
              </li>
            ),
          )}
          {outgoing.map(item => <li key={`outgoing-${item.id}`} data-item-id={`outgoing-${item.id}`} data-testid="chat-outgoing-message">
            <div className="flex justify-end px-3 py-1">
              <div className="flex max-w-[min(100%,36rem)] flex-col items-end gap-1">
                <div className="min-w-0 whitespace-pre-wrap break-words rounded-2xl rounded-br-xs bg-chat-accent px-3.5 py-2.5 text-[15px] leading-[1.45] text-canvas">
                  {item.kind === 'TEXT' ? item.body : item.kind === 'PHOTO' ? '사진' : item.kind === 'VIDEO' ? '영상' : '스티커'}
                </div>
                <div className="flex items-center gap-2 px-1 text-[12px] text-muted" role="status">
                  {item.saved ? <><Check className="size-3.5" aria-hidden="true" />보냄</> : item.sending || item.checking ? <><LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />보내는 중</> : <><CircleAlert className="size-3.5" aria-hidden="true" />전송이 지연되고 있어요</>}
                  {!item.sending && !item.checking && item.canRetry && onRetryOutgoing && <button type="button" className="rounded-full px-2 py-1 font-semibold text-chat-accent hover:bg-surface-soft focus-visible:outline-2 focus-visible:outline-focus-ring" disabled={outgoingBusy} onClick={() => void onRetryOutgoing(item.id)}>다시 보내기</button>}
                </div>
              </div>
            </div>
          </li>)}
        </ol>
      </div>

      {(unseenCount > 0 || showLatest) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="pointer-events-auto rounded-full shadow-sm"
            onClick={() => { userMovedRef.current = true; scrollToBottom('smooth'); }}
            data-testid="chat-jump-to-new"
          >
            {unseenCount > 0 ? `새 메시지 ${unseenCount}개 보기` : '최신 메시지로'}
          </Button>
        </div>
      )}

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="chat-live-region">
        {announcement}
      </div>
    </div>
  );
}

function buildEntries(items: ChatTimelineItem[]): Entry[] {
  const entries: Entry[] = [];
  let lastDate: Date | null = null;
  const now = new Date();

  for (const item of items) {
    const date = parseIsoDate(item.createdAt);
    if (date && (!lastDate || !isSameDay(lastDate, date))) {
      entries.push({ type: 'separator', key: `sep-${item.id}`, label: formatDateLabel(date, now) });
      lastDate = date;
    }
    entries.push({ type: 'item', item });
  }
  return entries;
}

function tailAfter(prev: ChatTimelineItem[], next: ChatTimelineItem[]): ChatTimelineItem[] {
  const prevLast = prev[prev.length - 1];
  if (!prevLast) return next;
  const index = next.findIndex((i) => i.id === prevLast.id);
  return index === -1 ? [] : next.slice(index + 1);
}

function announcementFor(newItems: ChatTimelineItem[]): string {
  if (newItems.length > 1) return `새 메시지 ${newItems.length}개`;
  const item = newItems[0];
  if (!item) return '';
  if (item.kind === 'publication') return `새 공개 메시지: ${truncateExcerpt(item.body, 40)}`;
  if (item.kind === 'unsupported') return '표시할 수 없는 새 메시지가 도착했습니다';
  if (item.status === 'deleted') return '';
  const scope = item.scope === 'PRIVATE' ? '개인 메시지' : '메시지';
  return `${item.author.displayName}님의 새 ${scope}: ${truncateExcerpt(item.body, 40)}`;
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}
