'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ChatRoomView, type ChatComposerSubmission, type ChatSubmitResult, type ChatTimelineItem } from '@/features/chat';
import { previewActors, previewConversationScopeKey, type PreviewRole, type PreviewRoom } from './fixtures/catalog';
import { buildPreviewTimeline, toActorRef } from './fixtures/chat-fixtures';
import { PREVIEW_BANNER_TEXT } from './preview-frame';

const PREVIEW_NOTICE = '미리보기 화면이에요. 실제 계정과 연결되지 않았고 보낸 내용은 저장되지 않아요.';
const UNKNOWN_AFTER_MS = 2500;
/**
 * Controlled outcomes for design/QA verification of delayed results. A body containing one of these
 * markers resolves the submit late so the target-switch race can be exercised in the browser.
 */
export const PREVIEW_DELAYED_REJECT_MARKER = '[거부]';
export const PREVIEW_DELAYED_ACCEPT_MARKER = '[지연]';
const DELAYED_RESULT_MS = 2000;

/**
 * QA harness around the chat presentation. The page mounts it with `key={conversationScopeKey}`, so a
 * room or role change is a fresh instance: no state, timer or draft survives across scopes. It supplies
 * the synthetic timeline and an in-memory `onSubmit` that shows the accepted message as `pending` and
 * then as `unknown` (result not confirmed). It never marks anything as saved: there is no server here.
 */
export function PreviewChatHarness({ role, room }: { role: PreviewRole; room: PreviewRoom }) {
  const viewer = toActorRef(role === 'fan' ? previewActors.fanA : actorOf(room.ownerActorId));
  const owner = toActorRef(actorOf(room.ownerActorId));
  const conversationScopeKey = previewConversationScopeKey(role, room);
  const [items, setItems] = useState<ChatTimelineItem[]>(() => buildPreviewTimeline(role, room));
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
      pending.length = 0;
    };
  }, []);

  const onSubmit = useCallback(
    (submission: ChatComposerSubmission): ChatSubmitResult | Promise<ChatSubmitResult> => {
      if (submission.body.includes(PREVIEW_DELAYED_REJECT_MARKER)) {
        return new Promise((resolve) => {
          timers.current.push(setTimeout(() => resolve({ accepted: false, reason: '미리보기: 요청한 지연 거부 시연이에요. 작성 내용은 유지돼요.' }), DELAYED_RESULT_MS));
        });
      }
      const id = `${conversationScopeKey}:local-${Date.now()}`;
      const item: ChatTimelineItem = {
        kind: 'message',
        id,
        scope: submission.target.scope,
        author: viewer,
        ...(submission.target.scope === 'PRIVATE' ? { recipient: submission.target.recipient } : {}),
        isOwn: true,
        body: submission.body,
        createdAt: new Date().toISOString(),
        status: 'pending',
        isPreviewSample: true,
      };
      const appendPending = () => {
        setItems((current) => [...current, item]);
        timers.current.push(
          setTimeout(() => {
            setItems((current) =>
              current.map((existing) =>
                existing.kind === 'message' && existing.id === id
                  ? { ...existing, status: 'unknown', statusNote: '결과 확인 중 (미리보기에서는 저장되지 않아요)' }
                  : existing,
              ),
            );
          }, UNKNOWN_AFTER_MS),
        );
      };
      const accepted: ChatSubmitResult = { accepted: true, note: '미리보기: 보내는 중으로 표시만 해요' };
      if (submission.body.includes(PREVIEW_DELAYED_ACCEPT_MARKER)) {
        return new Promise((resolve) => {
          timers.current.push(
            setTimeout(() => {
              appendPending();
              resolve(accepted);
            }, DELAYED_RESULT_MS),
          );
        });
      }
      appendPending();
      return accepted;
    },
    [conversationScopeKey, viewer],
  );

  return (
    <ChatRoomView
      conversationScopeKey={conversationScopeKey}
      roomName={room.title}
      viewer={viewer}
      viewerRole={role === 'fan' ? 'FAN' : 'STREAMER'}
      items={items}
      fanRecipient={role === 'fan' ? owner : undefined}
      streamerRecipients={role === 'streamer' ? room.authorizedFanActorIds.map((actorId) => toActorRef(actorOf(actorId))) : undefined}
      onSubmit={onSubmit}
      previewNotice={`${PREVIEW_BANNER_TEXT} · ${PREVIEW_NOTICE}`}
      className="min-h-0 flex-1"
    />
  );
}

function actorOf(actorId: string) {
  const actor = Object.values(previewActors).find((candidate) => candidate.actorId === actorId);
  if (!actor) throw new Error('Unknown preview actor');
  return actor;
}
