'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { SmilePlus } from 'lucide-react';
import { Popover } from 'radix-ui';
import type { ChatController, ChatState } from './chat-controller';
import type { ReactionSummary } from './reactions';

export const ReactionContext = createContext<{ controller: ChatController; reactions: ChatState['reactions']; reactionRevision: number } | null>(null);
const choices = [['👍', '좋아요'], ['❤️', '하트'], ['😂', '웃음'], ['🎉', '축하'], ['😮', '놀람'], ['😢', '슬픔']] as const;

/** Aggregates are rendered from the timeline snapshot; the picker offers other reactions. */
export function ReactionControl({ messageId, initialSummary, align = 'start' }: { messageId: string; initialSummary?: ReactionSummary; align?: 'start' | 'end' }) {
  const context = useContext(ReactionContext);
  const [open, setOpen] = useState(false);
  const state = context?.reactions[messageId];
  const controller = context?.controller;
  const revision = context?.reactionRevision;
  useEffect(() => {
    // Updated message versions invalidate the aggregate; only an open picker rereads it.
    if (open && !state && !initialSummary && controller) void controller.react(messageId);
  }, [open, state, initialSummary, controller, messageId, revision]);
  if (!controller) return null;
  const ready = state?.phase === 'ready' || (!state && initialSummary !== undefined);
  const busy = state?.phase === 'loading';
  const summary = state?.phase === 'ready' ? state.summary : state?.phase === 'loading' || !state ? initialSummary : null;
  const counts = summary?.counts ?? [];
  const choose = (emoji: string) => {
    if (!ready || !summary) return;
    void controller.react(messageId, summary.mine === emoji ? null : emoji);
    setOpen(false);
  };
  return <div className={`flex max-w-full flex-wrap items-center gap-1 pt-1 ${align === 'end' ? 'justify-end' : 'justify-start'}`} data-testid="chat-reactions">
    {counts.map(({ emoji, count }) => <button key={emoji} type="button" data-testid="chat-reaction-count" aria-label={`${emoji} 반응 ${count}개${summary?.mine === emoji ? ', 내 반응' : ''}`} aria-pressed={summary?.mine === emoji} disabled={!ready} onClick={() => choose(emoji)} className="relative inline-flex min-h-7 items-center gap-1 rounded-full bg-surface-soft px-2 text-[12px] leading-none text-body hover:bg-chat-other-bubble focus-visible:outline-2 focus-visible:outline-focus-ring before:absolute before:-inset-1.5 disabled:opacity-50">
      <span aria-hidden="true" className="text-[16px] leading-none">{emoji}</span><span aria-hidden="true">{count}</span>
    </button>)}
    <Popover.Root open={open} onOpenChange={next => {
      setOpen(next);
      if (next && !state && !initialSummary) void controller.react(messageId);
    }}>
      <Popover.Trigger asChild>
        <button type="button" aria-label="메시지에 반응 추가" aria-expanded={open} aria-busy={busy} data-testid="chat-reaction-trigger" className="relative flex size-7 items-center justify-center rounded-full bg-surface-soft text-muted hover:bg-chat-other-bubble hover:text-ink focus-visible:outline-2 focus-visible:outline-focus-ring before:absolute before:-inset-1.5">
          <SmilePlus className="size-4" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal><Popover.Content side="top" align="center" sideOffset={6} className="z-50 max-w-[calc(100vw-1rem)] rounded-2xl border border-line bg-canvas p-2 shadow-lg" aria-label="메시지 반응">
        <div role="group" aria-label="메시지 반응" aria-busy={busy} className="flex flex-wrap items-center justify-center gap-0.5">
          {choices.map(([emoji, label]) => <button key={emoji} type="button" aria-label={`${label} 반응`} aria-pressed={ready ? summary?.mine === emoji : undefined} disabled={!ready} onClick={() => choose(emoji)} className="flex size-11 items-center justify-center rounded-full text-2xl hover:bg-surface-soft focus-visible:outline-2 focus-visible:outline-chat-accent disabled:opacity-50">{emoji}</button>)}
        </div>
        {busy && <p role="status" className="px-2 pt-1 text-center text-xs text-muted">반응을 확인하는 중입니다.</p>}
        {state?.phase === 'error' && <div className="px-2 pt-1 text-center text-xs"><p role="alert" className="text-danger">{state.error}</p><button type="button" onClick={() => void controller.react(messageId)} className="mt-1 min-h-11 text-chat-accent">다시 시도</button></div>}
        {ready && summary?.mine && <button type="button" disabled={busy} onClick={() => { void controller.react(messageId, null); setOpen(false); }} className="mt-1 w-full min-h-11 rounded-lg text-xs text-muted hover:bg-surface-soft">내 반응 취소</button>}
      </Popover.Content></Popover.Portal>
    </Popover.Root>
  </div>;
}
