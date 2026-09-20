import type { Metadata } from 'next';
import { LoginView } from '@/features/auth/login-view';
import { LOGIN_REASON_MESSAGES, parseLoginReason } from '@/features/auth/login-reason';
export const metadata: Metadata = { title: '로그인', robots: { index: false, follow: false } };
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const reason = parseLoginReason(params.reason);
  return <LoginView reason={reason ? LOGIN_REASON_MESSAGES[reason] : undefined} />;
}
