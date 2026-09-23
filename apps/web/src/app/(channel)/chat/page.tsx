import type { Metadata } from 'next';
export const metadata: Metadata = { title: '채팅', robots: { index: false, follow: false } };
export default function ChatPage() {
  // The channel layout owns the mounted chat across route changes.
  return null;
}
