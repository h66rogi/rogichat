'use client';

import { useCallback, useId, useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent, FormEvent, ReactNode } from 'react';
import { CornerUpLeft, Lock, Send, X } from 'lucide-react';

import { Button } from '@/shared/ui/button';
import { cn } from '@/shared/lib/cn';

import { draftKeyFor } from './drafts';
import type { ChatComposerTarget, ChatQuotePreview } from './types';

/**
 * Message composer: optional reply preview, auto-growing textarea, send.
 *
 * Adapted from meloming-front 8db1289e6ce5b2b37028ddbb73863363870de6b5
 * src/domains/talk/components/room/TalkMessageInput.tsx: kept the native textarea with
 * auto-height capped at five lines, Enter to send / Shift+Enter for a new line, the
 * `isComposing` guard for Korean IME, and the reply-preview bar with a cancel button.
 * Fixed: height is measured from the rendered line height instead of a hard-coded
 * 120px and re-measured when the value changes programmatically (draft restore);
 * added the keyCode 229 / compositionstart fallback for browsers that report
 * `isComposing` late. Removed typing signals, analytics, emoticon picker,
 * attachment button and the numeric replyToId. Added separate polite/alert
 * result regions, focus retention while a send is pending, and 44px touch controls.
 */

export interface ChatComposerNotice {
  tone: 'info' | 'error';
  text: string;
}

export interface ChatComposerProps {
  target: ChatComposerTarget | null;
  /** Shown instead of the input when `target` is null or sending is not possible. */
  lockedReason?: string | undefined;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  quote?: ChatQuotePreview | null | undefined;
  onCancelQuote?: (() => void) | undefined;
  /** True while a send for THIS target is pending: input becomes read-only but keeps focus. */
  isSubmitting?: boolean | undefined;
  /** Result or guidance for the current target. Errors are announced assertively, info politely. */
  notice?: ChatComposerNotice | null | undefined;
  /** Polite, target-labelled announcement for results that arrived for another target. */
  announcement?: string | undefined;
  disabled?: boolean | undefined;
  /** Blocks dispatch during recovery without hiding or locking the editable draft. */
  submitBlockedReason?: string | undefined;
  submitBlocked?: boolean | undefined;
  onRetryBlocked?: (() => void) | undefined;
  attachmentAction?: ReactNode | undefined;
  className?: string | undefined;
}

const MAX_LINES = 5;

export function ChatComposer({
  target,
  lockedReason,
  value,
  onChange,
  onSubmit,
  quote = null,
  onCancelQuote,
  isSubmitting = false,
  notice = null,
  announcement = '',
  disabled = false,
  submitBlockedReason,
  submitBlocked = false,
  onRetryBlocked,
  attachmentAction,
  className,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const inputId = useId();
  const noticeId = useId();

  const locked = target === null || disabled;
  const isEmpty = value.trim().length === 0;
  const canSend = !locked && !isEmpty && !isSubmitting && !submitBlocked && !submitBlockedReason;

  // Auto-height: measure line-height once per render, cap at MAX_LINES.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const style = window.getComputedStyle(el);
    const lineHeight = Number.parseFloat(style.lineHeight) || 24;
    const vertical = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom) + Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
    const max = lineHeight * MAX_LINES + vertical;
    el.style.height = 'auto';
    const next = Math.min(el.scrollHeight, max);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [value]);

  const submit = useCallback(() => {
    if (!canSend) return;
    onSubmit();
    // A pending send disables the button; keep focus in the input rather than dropping it to <body>.
    textareaRef.current?.focus({ preventScroll: true });
  }, [canSend, onSubmit]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    // Korean IME: Enter that commits a composition must not send. Browsers differ in how
    // they report it, so check all three signals.
    if (event.nativeEvent.isComposing || event.keyCode === 229 || composingRef.current) return;
    event.preventDefault();
    submit();
  };

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };

  const errorText = notice?.tone === 'error' ? notice.text : '';
  const infoText = notice?.tone === 'info' ? notice.text : '';

  return (
    <form
      onSubmit={handleFormSubmit}
      autoComplete="off"
      className={cn('flex shrink-0 flex-col border-t border-line-subtle bg-canvas pb-[env(safe-area-inset-bottom)]', className)}
      data-testid="chat-composer"
      aria-label="메시지 작성"
    >
      {quote && (
        <div className="flex items-center gap-2 bg-surface-soft px-3 py-1.5" data-testid="chat-quote-preview">
          <CornerUpLeft className="size-4 shrink-0 text-muted" aria-hidden="true" />
          <div className="min-w-0 flex-1 text-[13px]">
            <span className="font-semibold text-body">{quote.authorName}님에게 비공개 답장</span>
            <span className="ml-1.5 text-muted">{quote.excerpt}</span>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onCancelQuote} disabled={isSubmitting} aria-label="비공개 답장 취소" data-testid="chat-quote-cancel">
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      )}

      {locked ? (
        <div className="flex min-h-14 items-center gap-2 px-4 py-3 text-[14px] text-muted" role="status">
          <Lock className="size-4 shrink-0" aria-hidden="true" />
          <span>{lockedReason ?? '지금은 메시지를 보낼 수 없습니다.'}</span>
        </div>
      ) : (
        <div className="flex items-end gap-2 px-3 py-2.5">
          {attachmentAction}
          <label htmlFor={inputId} className="sr-only">
            {quote ? `${quote.authorName}님에게 비공개 답장` : '전체 채팅 메시지 입력'}
          </label>
          <textarea
            id={inputId}
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            rows={1}
            placeholder={target?.scope === 'PRIVATE' ? '비공개 답장을 입력하세요' : '전체 채팅에 메시지 보내기'}
            readOnly={isSubmitting}
            aria-busy={isSubmitting}
            autoComplete="off"
            autoCapitalize="sentences"
            enterKeyHint="send"
            aria-describedby={notice ? noticeId : undefined}
            aria-invalid={notice?.tone === 'error' ? true : undefined}
            className={cn(
              'min-h-11 flex-1 resize-none rounded-2xl border border-transparent bg-chat-other-bubble px-4 py-2.5 text-[16px] leading-normal text-ink outline-none',
              'placeholder:text-muted focus-visible:border-chat-accent focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-chat-accent',
              'read-only:bg-surface-soft read-only:text-muted',
            )}
            data-testid="chat-composer-input"
            data-draft-key={target ? draftKeyFor(target) : undefined}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!canSend}
            aria-label={isSubmitting ? '보내는 중' : quote ? `${quote.authorName}님에게 비공개 답장 보내기` : '전체 채팅에 보내기'}
            aria-busy={isSubmitting}
            className="rounded-full bg-chat-accent text-white hover:bg-chat-accent-hover"
            data-testid="chat-composer-send"
          >
            <Send className="size-5" aria-hidden="true" />
          </Button>
        </div>
      )}

      {submitBlockedReason && <div className="flex items-center gap-2 px-4 pb-2 text-sm text-muted"><p role="status" className="flex-1">{submitBlockedReason}</p>{onRetryBlocked && <Button type="button" variant="ghost" size="sm" onClick={onRetryBlocked}>다시 시도</Button>}</div>}
      {/* Two regions so the assertive alert never carries a conflicting polite setting. */}
      <div id={noticeId} className={cn('px-4 text-[13px]', notice || announcement ? 'pb-2' : 'sr-only')} data-testid="chat-composer-notice">
        <p role="alert" className={cn('text-danger', !errorText && 'sr-only')} data-testid="chat-composer-error">
          {errorText}
        </p>
        <p role="status" aria-live="polite" aria-atomic="true" className={cn('text-muted', !infoText && !announcement && 'sr-only')} data-testid="chat-composer-status">
          {infoText}
          {infoText && announcement ? ' ' : ''}
          {announcement}
        </p>
      </div>
    </form>
  );
}
