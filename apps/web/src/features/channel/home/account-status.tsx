'use client';
import Link from 'next/link';
import { usePrivateSession } from '@/features/auth/private-session';
import { PrivateGate } from '@/features/auth/auth-panel';
import { SessionMediaProvider } from '@/features/media/session-ui';
import { ProfileAvatar } from '@/features/media/ProfileAvatar';
import { Button } from '@/shared/ui/button';
export function AccountStatus() {
  const { state, refresh } = usePrivateSession();
  if (state.kind === 'unauthenticated') return <p className="text-[14px] text-muted">SOOP으로 로그인하면 채팅방 참여 상태를 확인할 수 있습니다.</p>;
  if (state.kind === 'checking' || state.kind === 'hidden') return <div className="flex items-center gap-4 rounded-md border border-line p-5" aria-label="계정 정보 불러오는 중" role="status"><div className="size-16 rounded-full bg-surface-strong motion-safe:animate-pulse" /><div className="space-y-2"><div className="h-5 w-36 rounded bg-surface-strong motion-safe:animate-pulse" /><div className="h-4 w-24 rounded bg-surface-strong motion-safe:animate-pulse" /></div></div>;
  if (state.kind !== 'ready') return <PrivateGate state={state} retry={refresh} />;
  return <SessionMediaProvider csrf={state.session.csrfToken}><div className="flex flex-wrap items-center gap-4 rounded-md border border-line p-5"><ProfileAvatar profile={state.profile} /><div className="min-w-0"><p>{state.profile.nickname}님, 환영합니다.</p>{state.profile.soop?.displayId && <p className="break-all text-sm text-muted">SOOP ID · {state.profile.soop.displayId}</p>}</div><Button asChild variant="outline"><Link href="/settings">내 설정</Link></Button></div></SessionMediaProvider>;
}
