import type { Metadata } from 'next';
import { LoginView } from '@/features/auth/login-view';
export const metadata: Metadata = { title: '로그인 확인', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
export default function AuthCompletePage() { return <LoginView />; }
