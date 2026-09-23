import type { Metadata } from 'next';
import { ChannelChat } from '@/features/channel/session/channel-chat';
export const metadata: Metadata = { title: '채팅', robots: { index: false, follow: false } };
export default function ChatPage() {
  return (
    <div data-chat-page data-chat-column className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col md:border-x md:border-line-subtle">
      <ChannelChat />
    </div>
  );
}
