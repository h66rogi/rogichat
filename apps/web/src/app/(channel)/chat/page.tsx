import type { Metadata } from 'next';

import { SessionGatePanel } from '@/features/auth/session-gate-panel';

export const metadata: Metadata = {
  title: '채팅',
  robots: { index: false, follow: false },
};

/**
 * 후로기's chat room. Private: the browser-side gate decides what renders. In FW01 the gate always
 * reports that authentication is not connected, so no timeline is rendered here.
 */
export default function ChatPage() {
  return <SessionGatePanel screen="chat" />;
}
