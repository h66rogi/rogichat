import type { Metadata } from 'next';

import { PreviewFrame } from '@/preview/preview-frame';
import { PreviewChatHarness } from '@/preview/preview-chat-harness';
import { PreviewRoleSummary } from '@/preview/preview-role-summary';
import { isPreviewRoomKey, previewConversationScopeKey, previewRooms } from '@/preview/fixtures/catalog';

export const metadata: Metadata = {
  title: '스트리머 채팅 미리보기',
  robots: { index: false, follow: false },
};

/** QA-only streamer chat preview. `?room=other` switches to the second synthetic room to check isolation. */
export default async function StreamerChatPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const roomParam = typeof params.room === 'string' ? params.room : undefined;
  const room = previewRooms[isPreviewRoomKey(roomParam) ? roomParam : 'hurogi'];

  return (
    <PreviewFrame current="/preview/chat/streamer" fill>
      <PreviewRoleSummary role="streamer" room={room} />
      <div data-preview-slot="chat-streamer" className="flex h-[calc(100dvh-18rem)] min-h-[28rem] flex-col">
        <PreviewChatHarness key={previewConversationScopeKey('streamer', room)} role="streamer" room={room} />
      </div>
    </PreviewFrame>
  );
}
