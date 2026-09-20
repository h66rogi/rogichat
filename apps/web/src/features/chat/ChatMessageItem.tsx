'use client';

import { ChatPrivacyActions } from './ChatPrivacyActions';
import { Ban, Check, CircleAlert, CornerUpLeft, Lock, LoaderCircle, Megaphone, Reply } from 'lucide-react';

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
 * time/status column. Removed numeric IDs, read receipts, reactions/emoji pickers,
 * emoticon rendering, image/file attachments and analytics. Added scope labels,
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
}

export function ChatMessageItem({ item, viewerRole, onReplyPrivate, onDelete }: ChatMessageItemProps) {
  if (item.kind === 'publication') return <PublicationRow item={item} onDelete={onDelete} />;
  if (item.kind === 'unsupported') return <UnsupportedRow item={item} onDelete={onDelete} />;
  if (item.status === 'deleted') return <TombstoneRow item={item} />;
  return <MessageRow item={item} viewerRole={viewerRole} onReplyPrivate={onReplyPrivate} onDelete={onDelete} />;
}

function MessageRow({
  item,
  viewerRole,
  onReplyPrivate,
  onDelete,
}: {
  item: ChatMessageItemModel;
  viewerRole: ChatViewerRole;
  onDelete?: ((messageId: string) => Promise<ChatSubmitResult>) | undefined;
  onReplyPrivate?: ((item: ChatMessageItemModel) => void) | undefined;
}) {
  const isOwn = item.isOwn;
  const isPrivate = item.scope === 'PRIVATE';
  const canReply = !item.media && item.allowedActions?.reply === true && onReplyPrivate !== undefined;
  const timeLabel = timeLabelFor(item.createdAt);

  return (
    <div
      className={cn('flex gap-2 px-4 py-1.5', isOwn ? 'flex-row-reverse' : 'flex-row')}
      data-scope={item.scope}
      data-status={item.status}
    >
      {!isOwn && <ChatActorAvatar actor={item.author} />}

      <div className={cn('flex min-w-0 max-w-[min(100%,36rem)] flex-col gap-1', isOwn ? 'items-end' : 'items-start')}>
        <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-0.5 px-1 text-[12px] text-muted', isOwn && 'flex-row-reverse')}>
          {!isOwn && <span className="font-semibold text-body">{item.author.displayName}</span>}
          <ScopeLabel item={item} viewerRole={viewerRole} />
        </div>

        {item.quote && <QuoteBlock quote={item.quote} align={isOwn ? 'end' : 'start'} />}

        <div className={cn('flex items-end gap-1.5', isOwn ? 'flex-row-reverse' : 'flex-row')}>
          <div
            className={cn(
              'whitespace-pre-wrap break-words rounded-lg px-3.5 py-2.5 text-[16px] leading-normal',
              isOwn ? 'rounded-br-xs bg-ink text-canvas' : 'rounded-bl-xs bg-surface-soft text-ink',
              isPrivate && 'ring-1 ring-inset ring-line',
              item.status === 'rejected' && 'opacity-80',
            )}
          >
            {item.media ? <ChatMediaImages messageId={item.id} media={item.media} /> : item.body}
          </div>

          <div className="flex shrink-0 flex-col items-end gap-0.5 pb-0.5 text-[12px] text-muted">
            {isOwn && <StatusMark status={item.status} />}
            <time dateTime={item.createdAt}>{timeLabel}</time>
          </div>

          {item.allowedActions?.delete && item.status === 'saved' && onDelete && <DeleteMessageControl onDelete={() => onDelete(item.id)} />}

          {canReply && (
            <button
              type="button"
              onClick={() => onReplyPrivate(item)}
              className="flex size-11 shrink-0 items-center justify-center self-center rounded-full text-muted transition-colors hover:bg-surface-soft hover:text-ink"
              aria-label={replyLabelFor(item, viewerRole)}
              data-testid="chat-reply"
            >
              <Reply className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {item.status === 'saved' && <><ReactionControl messageId={item.id} /><ChatPrivacyActions messageId={item.id} /></>}

        {item.statusNote && (item.status === 'rejected' || item.status === 'unknown') && (
          <p className={cn('px-1 text-[12px]', item.status === 'rejected' ? 'text-danger' : 'text-muted')}>{item.statusNote}</p>
        )}
      </div>
    </div>
  );
}

function ScopeLabel({ item, viewerRole }: { item: ChatMessageItemModel; viewerRole: ChatViewerRole }) {
  if (item.scope === 'SHARED') {
    return (
      <span className="inline-flex items-center gap-1">
        <Megaphone className="size-3.5" aria-hidden="true" />
        전체 공개
      </span>
    );
  }

  const other = item.isOwn ? item.recipient : viewerRole === 'FAN' ? null : item.author;
  const text = item.isOwn
    ? other
      ? `${other.displayName}님에게만`
      : '개인 메시지'
    : viewerRole === 'FAN'
      ? '나에게만'
      : `${item.author.displayName}님과의 개인 대화`;

  return (
    <span className="inline-flex items-center gap-1 text-action">
      <Lock className="size-3.5" aria-hidden="true" />
      {text}
    </span>
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
          저장됨
        </span>
      );
    case 'unknown':
      return (
        <span className="inline-flex items-center gap-1" aria-label="결과 확인 중">
          <CircleAlert className="size-3.5" aria-hidden="true" />
          결과 확인 중
        </span>
      );
    case 'rejected':
      return (
        <span className="inline-flex items-center gap-1 text-danger" aria-label="전송 거부됨">
          <Ban className="size-3.5" aria-hidden="true" />
          전송 거부
        </span>
      );
    case 'deleted':
      return null;
  }
}

function QuoteBlock({ quote, align }: { quote: ChatQuotePreview; align: 'start' | 'end' }) {
  return (
    <div
      className={cn(
        'flex max-w-full flex-col gap-0.5 rounded-sm border-l-2 border-control-border bg-surface-soft px-2.5 py-1.5 text-[13px] text-muted',
        align === 'end' && 'self-end',
      )}
    >
      <span className="inline-flex items-center gap-1 font-semibold text-body">
        <CornerUpLeft className="size-3" aria-hidden="true" />
        {quote.authorName}
      </span>
      <span className="truncate">{quote.excerpt}</span>
    </div>
  );
}

function PublicationRow({ item, onDelete }: { item: ChatPublicationItemModel; onDelete?: ((id: string) => Promise<ChatSubmitResult>) | undefined }) {
  return (
    <div className="flex justify-center px-4 py-2" data-scope="PUBLICATION">
      <div className="flex w-full max-w-[36rem] flex-col gap-1.5 rounded-md border border-line bg-canvas px-4 py-3">
        <div className="flex items-center justify-between gap-2 text-[12px] text-muted">
          <span className="inline-flex items-center gap-1">
            <Megaphone className="size-3.5" aria-hidden="true" />
            개인 대화에서 공개된 메시지 · 보낸 사람 비공개
          </span>
          <time dateTime={item.createdAt}>{timeLabelFor(item.createdAt)}</time>
        </div>
        {item.media ? <ChatMediaImages messageId={item.id} media={item.media} /> : <p className="whitespace-pre-wrap break-words text-[16px] leading-normal text-ink">{item.body}</p>}
        <ReactionControl messageId={item.id} />
        <ChatPrivacyActions messageId={item.id} />
        {item.allowedActions?.delete && onDelete && <DeleteMessageControl onDelete={() => onDelete(item.id)} />}
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
        <ChatPrivacyActions messageId={item.id} />
        {item.allowedActions?.delete && onDelete && <DeleteMessageControl onDelete={() => onDelete(item.id)} />}
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

function replyLabelFor(item: ChatMessageItemModel, viewerRole: ChatViewerRole): string {
  if (viewerRole === 'FAN') return '이 메시지를 인용해 답장';
  return `${item.recipient?.displayName ?? item.author.displayName}님에게 개인 답장`;
}
