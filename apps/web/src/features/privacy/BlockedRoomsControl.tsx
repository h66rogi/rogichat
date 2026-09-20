'use client';
import { useEffect, useRef, useState } from 'react';
import type { Session } from '../../core/api/client';
import { Button } from '../../shared/ui/button';
import { PrivacyClient } from './client';
import { BlockedRoomsFlow, type BlockedRoom, type BlockedRoomsState } from './blocked-rooms';
import { BlockedActorsControl } from './moderation-components';

interface Props { origin: string; session: Session; generation: number; onReset: () => void }
export function BlockedRoomsControl(props: Props) {
  return <BlockedRoomsForm key={JSON.stringify([props.origin, props.session.accountPartition, props.session.csrfToken, props.generation])} {...props} />;
}
function BlockedRoomsForm(props: Props) {
  const [state, setState] = useState<BlockedRoomsState>({ phase: 'idle', rooms: [], nextCursor: null, restarted: false });
  const [selected, setSelected] = useState<BlockedRoom | null>(null);
  const flow = useRef<BlockedRoomsFlow | null>(null); const latest = useRef(props);
  useEffect(() => { latest.current = props; }, [props]);
  useEffect(() => {
    const current = latest.current;
    const instance = new BlockedRoomsFlow(new PrivacyClient(current.origin), current.session, next => { setSelected(null); setState(next); });
    flow.current = instance;
    return () => { instance.dispose(); flow.current = null; };
  }, []);
  return <section aria-label="내 차단 관리" className="space-y-4"><h2 className="font-semibold">내 차단 관리</h2>
    <p>지금 참여 중인 방과 관계없이, 이 계정에 남아 있는 차단을 확인합니다. 차단 해제가 방 참여 권한을 복구하지는 않습니다.</p>
    <Button variant="outline" disabled={state.phase === 'loading'} onClick={() => { void flow.current?.load(); }}>{state.phase === 'loading' ? '차단한 방 확인 중' : '차단한 방 찾기'}</Button>
    {state.phase === 'loading' && <p role="status">현재 계정의 차단 목록을 확인하고 있습니다.</p>}
    {state.phase === 'error' && <p role="alert">차단한 방을 확인하지 못했습니다. 차단한 방 찾기를 눌러 다시 확인해 주세요.</p>}
    {state.restarted && <p role="status">목록 연결이 만료되어 처음부터 다시 확인했습니다.</p>}
    {state.phase === 'ready' && <>
      {state.rooms.length === 0 && <p role="status">더 표시할 차단 목록이 없습니다.</p>}
      <ul>{state.rooms.map((room, index) => <li key={room.roomId}><Button variant="outline" onClick={() => setSelected(room)}>차단 목록 열기: {room.displayName ?? `이름을 확인할 수 없는 방 ${index + 1}`}</Button></li>)}</ul>
      {state.nextCursor !== null && <Button variant="outline" onClick={() => { void flow.current?.load(state.nextCursor); }}>다음 차단 방</Button>}
    </>}
    {selected && <div className="space-y-3"><p>{selected.displayName ?? '이름을 확인할 수 없는 방'}</p><BlockedActorsControl origin={props.origin} session={props.session} roomId={selected.roomId} generation={props.generation} onReset={props.onReset} /></div>}
  </section>;
}
