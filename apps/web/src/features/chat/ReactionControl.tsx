'use client';
import { createContext, useContext, useEffect, useId, useState } from 'react';
import { Button } from '@/shared/ui/button';
import type { ChatController, ChatState } from './chat-controller';

export const ReactionContext = createContext<{ controller: ChatController; reactions: ChatState['reactions']; reactionRevision: number } | null>(null);
const choices = [['👍', '좋아요'], ['❤️', '하트'], ['😂', '웃음'], ['🎉', '축하'], ['😮', '놀람'], ['😢', '슬픔']] as const;

/** Aggregate-only controls; anonymous rows use only their own server projection ID. */
export function ReactionControl({ messageId }: { messageId: string }) {
  const context = useContext(ReactionContext);
  const [open, setOpen] = useState(false);
  const id = useId();
  const state = context?.reactions[messageId];
  const controller = context?.controller;
  const revision = context?.reactionRevision;
  useEffect(() => {
    // MESSAGE_UPDATED invalidates the aggregate. Only opened controls re-read it.
    if (open && !state && controller) void controller.react(messageId);
  }, [open, state, controller, messageId, revision]);
  if (!context || !controller) return null;
  const ready = state?.phase === 'ready';
  const busy = state?.phase === 'loading';
  return <div className="max-w-full text-sm">
    <Button variant="ghost" size="sm" className="min-h-11" aria-expanded={open} aria-controls={id} onClick={() => {
      setOpen(!open); if (!open) void controller.react(messageId);
    }}>반응 {open ? '닫기' : '보기'}</Button>
    {open && <div id={id} role="group" aria-label="메시지 반응" aria-busy={busy} className="flex max-w-full flex-wrap items-center gap-1 rounded-lg border border-line p-2">
      {busy && <p role="status">반응을 확인하는 중입니다.</p>}
      {state?.phase === 'error' && <p role="alert" className="w-full text-danger">{state.error}</p>}
      {ready && state.summary && <>
        <p className="w-full text-muted" role="status">{state.summary.counts.length === 0 ? '아직 반응이 없습니다.' : '현재 반응 집계'}</p>
        {state.summary.counts.map(({ emoji, count }) => <Button key={emoji} variant="outline" size="sm" className="min-h-11" aria-label={`${emoji} 반응 ${count}개${state.summary?.mine === emoji ? ', 내 반응 해제' : ', 선택'}`} aria-pressed={state.summary?.mine === emoji} onClick={() => void controller.react(messageId, state.summary?.mine === emoji ? null : emoji)}>{emoji} {count}</Button>)}
      </>}
        <div className="flex w-full flex-wrap gap-1" role="group" aria-label="내 반응 선택">
          {choices.map(([emoji, label]) => <Button key={emoji} variant="ghost" size="sm" className="min-h-11 min-w-11" aria-label={`${label} 반응`} aria-disabled={!ready} aria-pressed={ready ? state?.summary?.mine === emoji : undefined} onClick={() => { if (ready) void controller.react(messageId, state?.summary?.mine === emoji ? null : emoji); }}>{emoji}</Button>)}
          <Button variant="ghost" size="sm" className="min-h-11" aria-disabled={!ready || !state?.summary?.mine} onClick={() => { if (ready && state?.summary?.mine) void controller.react(messageId, null); }}>내 반응 해제</Button>
        </div>
      <Button variant="outline" size="sm" className="min-h-11" disabled={busy} onClick={() => void controller.react(messageId)}>{ready ? '반응 새로고침' : '반응 다시 조회'}</Button>
    </div>}
  </div>;
}
