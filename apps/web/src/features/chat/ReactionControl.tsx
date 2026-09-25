'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { SmilePlus } from 'lucide-react';
import { Popover } from 'radix-ui';
import type { ChatController, ChatState } from './chat-controller';
import type { ReactionSummary } from './reactions';

export const ReactionContext = createContext<{ controller: ChatController; reactions: ChatState['reactions']; reactionRevision: number } | null>(null);
const choices = [['👍', '좋아요'], ['❤️', '하트'], ['😂', '웃음'], ['🎉', '축하'], ['😮', '놀람'], ['😢', '슬픔']] as const;

/** The picker is a direct message action; the API returns anonymous aggregates only. */
export function ReactionControl({ messageId, initialSummary }: { messageId: string; initialSummary?: ReactionSummary }) {
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
  return <div className="flex min-w-0 items-center gap-1">
    <Popover.Root open={open} onOpenChange={next => {
      setOpen(next);
      if (next && !state && !initialSummary) void controller.react(messageId);
    }}>
      <Popover.Trigger asChild>
        <button type="button" aria-label="메시지에 반응" aria-expanded={open} aria-busy={busy} data-testid="chat-reaction-trigger" className="flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-full px-2 text-sm text-muted hover:bg-surface-soft hover:text-ink focus-visible:text-ink">
          {counts.length ? <span className="flex items-center gap-0.5" aria-hidden="true">{counts.slice(0, 3).map(({ emoji, count }) => <span key={emoji}>{emoji}<span className="text-xs">{count}</span></span>)}</span> : <SmilePlus className="size-4" aria-hidden="true" />}
          {summary?.mine && <span className="sr-only">내 반응: {summary.mine}</span>}
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
