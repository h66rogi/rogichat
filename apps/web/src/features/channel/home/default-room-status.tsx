'use client';

import Link from 'next/link';
import { usePrivateSession } from '@/features/auth/private-session';
import { Button } from '@/shared/ui/button';
import { useRoom } from '../session/use-room';

/** Read the configured, persisted room; visiting home never joins on the user's behalf. */
export function DefaultRoomStatus() {
  const { state, refresh } = usePrivateSession();
  if (state.kind !== 'ready') return null;
  return <RoomStatus key={state.generation} retry={refresh} />;
}

function RoomStatus({ retry }: { retry: () => void }) {
  const state = useRoom();
  return <section aria-label="후로기 기본 채팅방" className="space-y-3 rounded-md border border-line p-5">
    <h2 className="text-[18px] font-semibold">후로기 채팅방</h2>
    {state.kind === 'checking' && <p role="status">채팅방 참여 상태를 확인하고 있습니다.</p>}
    {state.kind === 'ready' && <>
      <p>{state.room.name}</p>
      <p className="text-sm text-muted">{state.room.availability === 'OWNER_PENDING' ? '방장 계정을 확인하고 있습니다. 확인이 완료되면 입장할 수 있습니다.' : state.room.joined ? '참여 중인 채팅방입니다.' : '채팅방에 입장하여 후로기와 대화할 수 있습니다.'}</p>
      {state.room.availability === 'OWNER_PENDING' && <Button variant="outline" onClick={retry}>채팅방 다시 확인</Button>}
      {state.room.availability !== 'OWNER_PENDING' && <Button asChild><Link href="/chat">{state.room.joined ? '대화 이어가기' : '채팅방 확인'}</Link></Button>}
    </>}
    {state.kind === 'unconfigured' && <p>아직 채팅방이 열리지 않았습니다.</p>}
    {state.kind === 'unavailable' && <p>지금은 채팅방에 접근할 수 없습니다.</p>}
    {state.kind === 'error' && <p role="alert">채팅방 정보를 가져오지 못했습니다.</p>}
    {state.kind !== 'ready' && state.kind !== 'checking' && <Button variant="outline" onClick={retry}>채팅방 다시 확인</Button>}
  </section>;
}
