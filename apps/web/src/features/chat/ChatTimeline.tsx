'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronUp, LoaderCircle } from 'lucide-react';

import { Button } from '@/shared/ui/button';
import { cn } from '@/shared/lib/cn';

import { ChatMessageItem } from './ChatMessageItem';
import { formatDateLabel, isSameDay, parseIsoDate, truncateExcerpt } from './formatters';
import type { ChatMessageItemModel, ChatTimelineItem, ChatViewerRole } from './types';

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
  viewerRole: ChatViewerRole;
  onReplyPrivate?: ((item: ChatMessageItemModel) => void) | undefined;
  onLoadOlder?: (() => void | Promise<void>) | undefined;
  hasOlder?: boolean | undefined;
  isLoadingOlder?: boolean | undefined;
  ariaLabel?: string | undefined;
  className?: string | undefined;
}

type Entry = { type: 'separator'; key: string; label: string } | { type: 'item'; item: ChatTimelineItem };

const BOTTOM_THRESHOLD_PX = 32;
const TOP_LOAD_THRESHOLD_PX = 80;

export function ChatTimeline({
  items,
  viewerRole,
  onReplyPrivate,
  onLoadOlder,
  hasOlder = false,
  isLoadingOlder = false,
  ariaLabel = '채팅 메시지',
  className,
}: ChatTimelineProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<{ id: string; offset: number } | null>(null);
  const wasAtBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const prevItemsRef = useRef<ChatTimelineItem[] | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [unseenCount, setUnseenCount] = useState(0);

  const scrollToBottom = useCallback((behavior: ScrollBehavior) => {
    const el = viewportRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    wasAtBottomRef.current = true;
    setUnseenCount(0);
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
    if (wasAtBottomRef.current) setUnseenCount(0);
  }, []);

  const handleScroll = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const previousTop = lastScrollTopRef.current;
    lastScrollTopRef.current = el.scrollTop;
    recordAnchor();

    const scrollingUp = el.scrollTop < previousTop;
    const overflows = el.scrollHeight > el.clientHeight;
    if (scrollingUp && overflows && hasOlder && !isLoadingOlder && onLoadOlder && el.scrollTop < TOP_LOAD_THRESHOLD_PX) {
      void onLoadOlder();
    }
  }, [hasOlder, isLoadingOlder, onLoadOlder, recordAnchor]);

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
        role="region"
        aria-label={ariaLabel}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring"
        data-testid="chat-timeline"
      >
        <ol className="flex min-h-full flex-col py-2">
          {(hasOlder || isLoadingOlder) && (
            <li className="flex justify-center py-2" role="presentation">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void onLoadOlder?.()}
                disabled={isLoadingOlder || !onLoadOlder}
                aria-busy={isLoadingOlder}
                data-testid="chat-load-older"
              >
                {isLoadingOlder ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <ChevronUp className="size-4" aria-hidden="true" />}
                {isLoadingOlder ? '이전 메시지를 불러오는 중' : '이전 메시지 보기'}
              </Button>
            </li>
          )}

          {items.length === 0 && (
            <li className="flex flex-1 items-center justify-center px-6 py-16 text-center text-[14px] text-muted" role="presentation">
              아직 메시지가 없습니다. 첫 메시지를 보내면 여기에 표시됩니다.
            </li>
          )}

          {entries.map((entry) =>
            entry.type === 'separator' ? (
              <li key={entry.key} className="flex items-center gap-3 px-4 py-3" role="presentation">
                <span className="h-px flex-1 bg-line-subtle" aria-hidden="true" />
                <span className="shrink-0 text-[12px] font-semibold text-muted">{entry.label}</span>
                <span className="h-px flex-1 bg-line-subtle" aria-hidden="true" />
              </li>
            ) : (
              <li key={entry.item.id} data-item-id={entry.item.id} data-testid="chat-timeline-item">
                <ChatMessageItem item={entry.item} viewerRole={viewerRole} onReplyPrivate={onReplyPrivate} />
              </li>
            ),
          )}
        </ol>
      </div>

      {unseenCount > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="pointer-events-auto rounded-full shadow-sm"
            onClick={() => scrollToBottom('smooth')}
            data-testid="chat-jump-to-new"
          >
            새 메시지 {unseenCount}개 보기
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
