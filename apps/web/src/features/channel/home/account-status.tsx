'use client';
import Link from 'next/link';
import { usePrivateSession } from '@/features/auth/private-session';
import { PrivateGate } from '@/features/auth/auth-panel';
import { Button } from '@/shared/ui/button';
export function AccountStatus() {
  const { state, refresh } = usePrivateSession();
  if (state.kind === 'unauthenticated') return <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-line bg-surface-soft p-5"><p className="text-[14px] text-body">SOOP으로 로그인하면 후로기 채팅방에 참여할 수 있습니다.</p><Button asChild variant="outline"><Link href="/login">SOOP으로 로그인</Link></Button></div>;
  if (state.kind === 'checking' || state.kind === 'hidden') return <p role="status" className="text-[14px] text-muted">로그인 상태를 확인하고 있습니다.</p>;
  if (state.kind !== 'ready') return <PrivateGate state={state} retry={refresh} />;
  return <div className="flex flex-wrap items-center gap-4 rounded-md border border-line p-5"><p>{state.profile.nickname}님, 환영합니다.</p><Button asChild variant="outline"><Link href="/settings">내 설정</Link></Button></div>;
}
