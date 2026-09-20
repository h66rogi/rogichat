import type { Metadata } from 'next';
import { RealSettings } from '@/features/settings/real-settings';
export const metadata: Metadata = { title: '내 설정', robots: { index: false, follow: false } };
export default function SettingsPage() { return <RealSettings />; }
