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
  if (state.kind === 'checking' || state.kind === 'hidden') return <p role="status" className="text-[14px] text-muted">로그인 상태를 확인하고 있습니다.</p>;
  if (state.kind !== 'ready') return <PrivateGate state={state} retry={refresh} />;
  return <SessionMediaProvider csrf={state.session.csrfToken}><div className="flex flex-wrap items-center gap-4 rounded-md border border-line p-5"><ProfileAvatar profile={state.profile} /><div className="min-w-0"><p>{state.profile.nickname}님, 환영합니다.</p>{state.profile.soop?.displayId && <p className="break-all text-sm text-muted">SOOP ID · {state.profile.soop.displayId}</p>}</div><Button asChild variant="outline"><Link href="/settings">내 설정</Link></Button></div></SessionMediaProvider>;
}
