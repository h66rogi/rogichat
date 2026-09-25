'use client';

import { ChatPrivacyActions } from './ChatPrivacyActions';
import { Ban, Check, CircleAlert, CornerUpLeft, Ellipsis, LoaderCircle, Megaphone, Reply } from 'lucide-react';
import { Popover } from 'radix-ui';

import { ChatActorAvatar } from './ChatActorAvatar';
import { cn } from '@/shared/lib/cn';

import { ReactionControl } from './ReactionControl';
import { ChatMediaImages } from './ChatMedia';
import { DeleteMessageControl } from './DeleteMessageControl';
import { formatTimeLabel, parseIsoDate } from './formatters';
import type {
  ChatSubmitResult,
  ChatMessageItemModel,
  ChatMessageStatus,
  ChatPublicationItemModel,
  ChatQuotePreview,
  ChatTimelineItem,
  ChatUnsupportedItemModel,
  ChatViewerRole,
} from './types';

/**
 * One timeline row.
 *
 * Adapted from meloming-front 8db1289e6ce5b2b37028ddbb73863363870de6b5
 * src/domains/talk/components/room/TalkMessageBubble.tsx: kept the own/other alignment,
 * avatar + name column, reply-quote block above the bubble, deleted tombstone and the
 * time/status column. Removed numeric IDs, read receipts,
 * emoticon rendering, image/file attachments and analytics. Added
 * PRIVATE recipient display, anonymous publication rows, unknown/rejected statuses,
 * an always-visible, keyboard-reachable reply button (the hover-only controls of the
 * original were dropped) and an "unsupported content" placeholder.
 * Publication rows carry body and time only: no author, no quote, no link to the origin.
 */

export interface ChatMessageItemProps {
  item: ChatTimelineItem;
  viewerRole: ChatViewerRole;
  /** Offered only where a private reply makes sense; the room view decides the target. */
  onDelete?: ((messageId: string) => Promise<ChatSubmitResult>) | undefined;
  onReplyPrivate?: ((item: ChatMessageItemModel) => void) | undefined;
  onQuoteNavigate?: ((messageId: string) => void) | undefined;
}

export function ChatMessageItem({ item, viewerRole, onReplyPrivate, onDelete, onQuoteNavigate }: ChatMessageItemProps) {
  if (item.kind === 'publication') return <PublicationRow item={item} onDelete={onDelete} />;
  if (item.kind === 'unsupported') return <UnsupportedRow item={item} onDelete={onDelete} />;
  if (item.status === 'deleted') return <TombstoneRow item={item} />;
  return <MessageRow item={item} viewerRole={viewerRole} onReplyPrivate={onReplyPrivate} onDelete={onDelete} onQuoteNavigate={onQuoteNavigate} />;
}

function MessageRow({
  item,
  viewerRole,
  onReplyPrivate,
  onDelete,
  onQuoteNavigate,
}: {
  item: ChatMessageItemModel;
  viewerRole: ChatViewerRole;
  onDelete?: ((messageId: string) => Promise<ChatSubmitResult>) | undefined;
  onReplyPrivate?: ((item: ChatMessageItemModel) => void) | undefined;
  onQuoteNavigate?: ((messageId: string) => void) | undefined;
}) {
  const isOwn = item.isOwn;
  const isPrivate = item.scope === 'PRIVATE';
  const canReply = !isOwn && !item.media && item.allowedActions?.reply === true && onReplyPrivate !== undefined;
  const timeLabel = timeLabelFor(item.createdAt);

  return (
    <div
      className={cn('flex gap-2 px-3 py-1', isOwn ? 'flex-row-reverse' : 'flex-row')}
      data-scope={item.scope}
      data-status={item.status}
    >
      {!isOwn && <ChatActorAvatar actor={item.author} />}

      <div className={cn('flex min-w-0 max-w-[min(100%,36rem)] flex-col gap-0.5', isOwn ? 'items-end' : 'items-start')}>
        {!isOwn && <span className="px-1 text-[12px] font-semibold text-body">{item.author.displayName}</span>}

        {item.quote && <QuoteBlock quote={item.quote} align={isOwn ? 'end' : 'start'} onNavigate={onQuoteNavigate} />}

        <div className={cn('flex min-w-0 items-end gap-1.5', isOwn ? 'flex-row-reverse' : 'flex-row')}>
          <div
            className={cn(
              'min-w-0 whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[15px] leading-[1.45]',
              isOwn ? 'rounded-br-xs bg-chat-accent text-canvas' : 'rounded-bl-xs bg-chat-other-bubble text-ink',
              isPrivate && !isOwn && 'ring-1 ring-inset ring-line',
              item.status === 'rejected' && 'opacity-80',
            )}
          >
            {item.media ? <ChatMediaImages messageId={item.id} media={item.media} /> : item.body}
          </div>

          <div className="flex shrink-0 flex-col items-end gap-0.5 pb-0.5 text-[12px] text-muted">
            {isOwn && <StatusMark status={item.status} />}
            <time dateTime={item.createdAt}>{timeLabel}</time>
          </div>
          {(canReply || item.status === 'saved' || (item.allowedActions?.delete && onDelete)) && <div className={cn('flex shrink-0 items-center gap-0.5', isOwn && 'flex-row-reverse')}>
            {item.status === 'saved' && <ReactionControl messageId={item.id} initialSummary={item.reactions} />}
            {canReply && <button type="button" onClick={() => onReplyPrivate(item)} className="flex size-11 items-center justify-center rounded-full text-chat-accent hover:bg-surface-soft focus-visible:outline-2 focus-visible:outline-focus-ring" aria-label={replyLabelFor(item, viewerRole)} title="비공개 답장" data-testid="chat-reply"><Reply className="size-5" aria-hidden="true" /></button>}
            <MessageActionMenu>
              {item.status === 'saved' && <ChatPrivacyActions messageId={item.id} />}
              {item.allowedActions?.delete && item.status === 'saved' && onDelete && <DeleteMessageControl onDelete={() => onDelete(item.id)} />}
            </MessageActionMenu>
          </div>}
        </div>

        {item.statusNote && (item.status === 'rejected' || item.status === 'unknown') && (
          <p className={cn('px-1 text-[12px]', item.status === 'rejected' ? 'text-danger' : 'text-muted')}>{item.statusNote}</p>
        )}
      </div>
    </div>
  );
}

function StatusMark({ status }: { status: ChatMessageStatus }) {
  switch (status) {
    case 'pending':
      return (
        <span className="inline-flex items-center gap-1" aria-label="보내는 중">
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
          보내는 중
        </span>
      );
    case 'saved':
      return (
        <span className="inline-flex items-center gap-1" aria-label="저장됨">
          <Check className="size-3.5" aria-hidden="true" />
          <span className="sr-only">저장됨</span>
        </span>
      );
    case 'unknown':
      return (
        <span className="inline-flex items-center gap-1" aria-label="전송이 지연되고 있어요">
          <CircleAlert className="size-3.5" aria-hidden="true" />
          전송이 지연되고 있어요
        </span>
      );
    case 'rejected':
      return (
        <span className="inline-flex items-center gap-1 text-danger" aria-label="보내지 못함">
          <Ban className="size-3.5" aria-hidden="true" />
          보내지 못함
        </span>
      );
    case 'deleted':
      return null;
  }
}

function QuoteBlock({ quote, align, onNavigate }: { quote: ChatQuotePreview; align: 'start' | 'end'; onNavigate?: ((messageId: string) => void) | undefined }) {
  return (
    <button type="button" onClick={() => onNavigate?.(quote.messageId)} aria-label={`${quote.authorName}님의 원본 메시지로 이동`} disabled={!onNavigate}
      className={cn(
        'flex max-w-full flex-col gap-0.5 rounded-sm border-l-2 border-control-border bg-surface-soft px-2.5 py-1.5 text-left text-[13px] text-muted hover:bg-chat-other-bubble focus-visible:outline-2 focus-visible:outline-focus-ring',
        align === 'end' && 'self-end',
      )}
    >
      <span className="inline-flex items-center gap-1 font-semibold text-body">
        <CornerUpLeft className="size-3" aria-hidden="true" />
        {quote.authorName}
      </span>
      <span className="truncate">{quote.excerpt}</span>
    </button>
  );
}

function PublicationRow({ item, onDelete }: { item: ChatPublicationItemModel; onDelete?: ((id: string) => Promise<ChatSubmitResult>) | undefined }) {
  return (
    <div className="flex justify-center px-4 py-2" data-scope="PUBLICATION">
      <div className="flex w-full max-w-[36rem] flex-col gap-1.5 rounded-2xl border border-line bg-surface-soft px-4 py-3">
        <div className="flex items-center justify-between gap-2 text-[12px] text-muted">
          <span className="inline-flex items-center gap-1">
            <Megaphone className="size-3.5" aria-hidden="true" />
            개인 대화에서 공개된 메시지 · 보낸 사람 비공개
          </span>
          <time dateTime={item.createdAt}>{timeLabelFor(item.createdAt)}</time>
        </div>
        {item.media ? <ChatMediaImages messageId={item.id} media={item.media} /> : <p className="whitespace-pre-wrap break-words text-[16px] leading-normal text-ink">{item.body}</p>}
        <div className="flex items-center gap-1"><ReactionControl messageId={item.id} initialSummary={item.reactions} /><MessageActionMenu><ChatPrivacyActions messageId={item.id} />{item.allowedActions?.delete && onDelete && <DeleteMessageControl onDelete={() => onDelete(item.id)} />}</MessageActionMenu></div>
      </div>
    </div>
  );
}

function TombstoneRow({ item }: { item: ChatMessageItemModel }) {
  return (
    <div className={cn('flex gap-2 px-4 py-1.5', item.isOwn ? 'justify-end' : 'justify-start')} data-status="deleted">
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-line px-3 py-2 text-[14px] text-muted">
        <span className="italic">삭제된 메시지입니다</span>
        <time dateTime={item.createdAt} className="text-[12px]">
          {timeLabelFor(item.createdAt)}
        </time>
      </div>
    </div>
  );
}

function UnsupportedRow({ item, onDelete }: { item: ChatUnsupportedItemModel; onDelete?: ((id: string) => Promise<ChatSubmitResult>) | undefined }) {
  return (
    <div className="flex justify-center px-4 py-1.5" data-status="unsupported">
      <div className="inline-flex items-center gap-2 rounded-lg bg-surface-soft px-3 py-2 text-[14px] text-muted">
        <CircleAlert className="size-4" aria-hidden="true" />
        <span>이 화면에서 표시할 수 없는 내용입니다.</span>
        <MessageActionMenu>
          <ChatPrivacyActions messageId={item.id} />
          {item.allowedActions?.delete && onDelete && <DeleteMessageControl onDelete={() => onDelete(item.id)} />}
        </MessageActionMenu>
        <time dateTime={item.createdAt} className="text-[12px]">
          {timeLabelFor(item.createdAt)}
        </time>
      </div>
    </div>
  );
}

function timeLabelFor(iso: string): string {
  const date = parseIsoDate(iso);
  return date ? formatTimeLabel(date) : '시각 정보 없음';
}

function replyLabelFor(item: ChatMessageItemModel, _viewerRole: ChatViewerRole): string {
  return `${item.author.displayName}님에게 비공개 답장`;
}

function MessageActionMenu({ children }: { children: React.ReactNode }) {
  return <Popover.Root>
    <Popover.Trigger asChild>
      <button type="button" className="-my-1 flex size-11 items-center justify-center rounded-full text-muted hover:bg-surface-soft hover:text-ink focus-visible:text-ink" aria-label="메시지 옵션" data-testid="chat-message-options"><Ellipsis className="size-4" aria-hidden="true" /></button>
    </Popover.Trigger>
    <Popover.Portal forceMount><Popover.Content forceMount side="top" align="start" sideOffset={4} className="z-50 max-h-[60dvh] w-64 overflow-y-auto rounded-xl border border-line bg-canvas p-2 shadow-lg data-[state=closed]:hidden" aria-label="메시지 옵션">{children}</Popover.Content></Popover.Portal>
  </Popover.Root>;
}
