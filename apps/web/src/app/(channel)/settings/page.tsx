import type { Metadata } from 'next';

import { SessionGatePanel } from '@/features/auth/session-gate-panel';

export const metadata: Metadata = {
  title: '내 설정',
  robots: { index: false, follow: false },
};

/** My settings. Private: gated in the browser like /chat. Settings sections render only after the gate. */
export default function SettingsPage() {
  return <SessionGatePanel screen="settings" />;
}
