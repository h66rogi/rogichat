import type { Metadata } from 'next';
import { RealNotificationInbox } from '@/features/notifications/RealNotificationInbox';

export const metadata: Metadata = { title: '알림', robots: { index: false, follow: false } };
export default function NotificationsPage() { return <RealNotificationInbox />; }
