import type { Metadata } from 'next';
import { ChannelChat } from '@/features/channel/session/channel-chat';
export const metadata: Metadata = { title: '채팅', robots: { index: false, follow: false } };
export default function ChatPage() { return <ChannelChat />; }
