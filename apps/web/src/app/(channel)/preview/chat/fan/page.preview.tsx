import type { Metadata } from 'next';

import { PreviewFrame } from '@/preview/preview-frame';
import { PreviewChatHarness } from '@/preview/preview-chat-harness';
import { PreviewRoleSummary } from '@/preview/preview-role-summary';
import { isPreviewRoomKey, previewConversationScopeKey, previewRooms } from '@/preview/fixtures/catalog';

export const metadata: Metadata = {
  title: '팬 채팅 미리보기',
  robots: { index: false, follow: false },
};

/** QA-only fan chat preview. `?room=other` switches to the second synthetic room to check isolation. */
export default async function FanChatPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const roomParam = typeof params.room === 'string' ? params.room : undefined;
  const room = previewRooms[isPreviewRoomKey(roomParam) ? roomParam : 'hurogi'];

  return (
    <PreviewFrame current="/preview/chat/fan" fill>
      <PreviewRoleSummary role="fan" room={room} />
      <div data-preview-slot="chat-fan" className="flex h-[calc(100dvh-18rem)] min-h-[28rem] flex-col">
        <PreviewChatHarness key={previewConversationScopeKey('fan', room)} role="fan" room={room} />
      </div>
    </PreviewFrame>
  );
}
