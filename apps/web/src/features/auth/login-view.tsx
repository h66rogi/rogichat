'use client';
import Link from 'next/link';
import { Button } from '@/shared/ui/button';
import { usePrivateSession } from './private-session';
import { PrivateGate, SoopButton } from './auth-panel';
import { PasswordLogin } from './password-login';
export function LoginView({ reason }: { reason?: string | undefined }) {
  const { state, refresh } = usePrivateSession();
  if (state.kind === 'unauthenticated') return <section className="flex flex-col gap-6"><h1 className="text-[28px] font-bold text-ink">로기챗 로그인</h1><p className="text-body">SOOP 계정으로 후로기의 채팅 공간에 참여하세요.</p>{reason && <p role="status" className="text-body">{reason}</p>}<SoopButton /><PasswordLogin /></section>;
  if (state.kind !== 'ready') return <PrivateGate state={state} retry={refresh} />;
  return <section className="flex flex-col gap-5"><h1 className="text-[24px] font-semibold text-ink">로그인되어 있어요</h1><p>{state.profile.nickname}님, 로기챗에 오신 것을 환영합니다.</p><Button asChild><Link href="/chat">채팅으로</Link></Button><Button asChild variant="outline"><Link href="/settings">내 설정</Link></Button></section>;
}
