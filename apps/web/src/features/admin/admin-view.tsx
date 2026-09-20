'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, type Session } from '@/core/api/client';
import { parseAccountCapabilities, parseGrants, parseRoomCapabilities, type RoomCapabilities, type TestGrant } from '@/core/api/access-contract';
import { useApi } from '@/core/runtime/provider';
import { PrivateGate, StatePanel } from '@/features/auth/auth-panel';
import { invalidateSession, usePrivateSession } from '@/features/auth/private-session';
import { useRoom } from '@/features/channel/session/use-room';
import { Button } from '@/shared/ui/button';

export function AdminView() {
  const { state, refresh } = usePrivateSession();
  if (state.kind !== 'ready') return <PrivateGate state={state} retry={refresh} />;
  return <AdminAccount key={state.generation} session={state.session} />;
}
function AdminAccount({ session }: { session: Session }) {
  const api = useApi(); const room = useRoom();
  const [permission, setPermission] = useState<'checking' | 'denied' | 'allowed' | 'error'>('checking');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const capabilities = parseAccountCapabilities(await api.request('/v1/me/capabilities', { signal: controller.signal }));
        const current = await api.session(controller.signal);
        if (current.csrfToken !== session.csrfToken || current.accountPartition !== session.accountPartition) { invalidateSession(); return; }
        if (!controller.signal.aborted) setPermission(capabilities.admin.enabled && capabilities.admin.manageTestAccess ? 'allowed' : 'denied');
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) invalidateSession();
        else setPermission(error instanceof ApiError && error.status === 403 ? 'denied' : 'error');
      }
    })();
    return () => controller.abort();
  }, [api, session, attempt]);
  if (permission === 'denied') return <StatePanel title="관리자 권한이 필요합니다">이 계정에는 임시 권한 관리 권한이 없습니다.</StatePanel>;
  if (permission === 'error') return <StatePanel title="관리자 권한을 확인하지 못했습니다" retry={() => setAttempt(value => value + 1)} />;
  if (permission !== 'allowed' || room.kind === 'checking') return <StatePanel title="관리 권한을 확인하고 있습니다" />;
  if (room.kind !== 'ready') return <StatePanel title="기본방을 확인할 수 없습니다" retry={invalidateSession}>서버의 기본방 정보를 확인한 뒤 다시 이용해 주세요.</StatePanel>;
  if (!room.room.joined) return <StatePanel title="채팅방에 먼저 참여해 주세요"><p>임시 권한은 현재 참여 중인 방에만 발급할 수 있습니다.</p><Button asChild><Link href="/chat">채팅방 참여하기</Link></Button></StatePanel>;
  return <RoomAccess session={session} roomId={room.room.roomId} roomName={room.room.name} />;
}
function RoomAccess({ session, roomId, roomName }: { session: Session; roomId: string; roomName: string }) {
  const api = useApi(); const path = `/v1/admin/rooms/${encodeURIComponent(roomId)}/test-grants`;
  const [data, setData] = useState<{ capabilities: RoomCapabilities; grants: TestGrant[]; next: string | null } | null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  const operating = useRef(false);
  // Preserve the exact operation key and body on ambiguous outcomes; never auto-retry POST.
  const pending = useRef<{ requestId: string; durationSeconds: number; reason: string } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const confirm = useCallback(async (signal: AbortSignal) => {
    const current = await api.session(signal);
    if (current.csrfToken !== session.csrfToken || current.accountPartition !== session.accountPartition) { invalidateSession(); throw new ApiError(403, 'SESSION_CHANGED'); }
  }, [api, session]);
  const load = useCallback(async (signal: AbortSignal, after?: string) => {
    const capabilities = parseRoomCapabilities(await api.request(`/v1/rooms/${encodeURIComponent(roomId)}/capabilities`, { signal }));
    const page = parseGrants(await api.request(path + (after ? `?after=${encodeURIComponent(after)}` : ''), { signal }));
    if (page.grants.some(grant => grant.roomId !== roomId)) throw new ApiError(502, 'INVALID_GRANTS');
    await confirm(signal);
    if (!signal.aborted) setData(previous => ({ capabilities, grants: after && previous ? [...previous.grants, ...page.grants.filter(grant => !previous.grants.some(old => old.grantId === grant.grantId))] : page.grants, next: page.next }));
  }, [api, path, roomId, confirm]);
  const failed = useCallback((failure: unknown) => {
    if (failure instanceof ApiError && [401, 403].includes(failure.status)) { setData(null); invalidateSession(); }
    else setError(failure instanceof ApiError ? failure.message : '서버 상태를 확인하지 못했습니다. 다시 확인해 주세요.');
  }, []);
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    const initial = window.setTimeout(() => { void load(controller.signal).catch(error => { if (!controller.signal.aborted) failed(error); }); }, 0);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearTimeout(initial); window.clearInterval(clock); controller.abort(); };
  }, [load, failed]);
  // Withdraw expired authorization by refreshing the real session and server projection.
  useEffect(() => {
    const expiresAt = data?.capabilities.temporaryStreamer?.expiresAt;
    if (!expiresAt) return;
    const timer = window.setTimeout(invalidateSession, Math.max(1000, Math.min(2147483647, Date.parse(expiresAt) - Date.now() + 1000)));
    return () => window.clearTimeout(timer);
  }, [data?.capabilities.temporaryStreamer?.expiresAt]);
  const operation = async (action: (signal: AbortSignal) => Promise<void>) => {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || operating.current) return;
    operating.current = true; setBusy(true); setError('');
    try { await confirm(signal); await action(signal); }
    catch (error) { if (!signal.aborted) failed(error); }
    finally { operating.current = false; if (!signal.aborted) setBusy(false); }
  };
  const grant = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pending.current) {
      const fields = new FormData(event.currentTarget);
      const reason = String(fields.get('reason') ?? '').trim();
      if (!reason) { setError('발급 사유를 입력해 주세요.'); return; }
      pending.current = { requestId: crypto.randomUUID(), durationSeconds: Number(fields.get('duration')), reason };
    }
    await operation(async signal => {
      setUncertain(true);
      try { await api.request(path, { method: 'POST', csrf: session.csrfToken, body: pending.current, signal }); }
      catch (error) {
        if (error instanceof ApiError && error.status === 400) { pending.current = null; setUncertain(false); }
        throw error;
      }
      await load(signal);
      if (!signal.aborted) { pending.current = null; setUncertain(false); invalidateSession(); }
    });
  };
  const canIssue = data?.capabilities.effectiveRole === 'FAN' && data.capabilities.temporaryStreamer === null;
  return <section className="mx-auto flex max-w-xl flex-col gap-5 px-4 py-8"><h1 className="text-2xl font-semibold">관리자 페이지</h1><h2 className="text-lg font-medium">{roomName} · 임시 스트리머 권한</h2><p>현재 로그인한 내 계정에만 적용됩니다. 설정한 시간이 지나거나 회수하면 권한이 종료됩니다.</p>
    {error && <p role="alert">{error}</p>}
    <Button variant="outline" disabled={busy} onClick={() => void operation(signal => load(signal))}>서버 상태 다시 확인</Button>
    {data && <><p>현재 역할: {data.capabilities.effectiveRole === 'STREAMER' ? '스트리머' : data.capabilities.effectiveRole === 'FAN' ? '팬' : '멤버'}</p>{data.capabilities.temporaryStreamer && <p>임시 권한 만료: <time dateTime={data.capabilities.temporaryStreamer.expiresAt}>{new Date(data.capabilities.temporaryStreamer.expiresAt).toLocaleString()}</time></p>}
    {!canIssue && <p>현재 역할에서는 새 임시 권한을 발급할 수 없습니다. 기존 임시 권한이 있다면 먼저 회수해 주세요.</p>}
    <form className="flex flex-col gap-4" onSubmit={event => void grant(event)}>
      <label className="flex flex-col gap-2">유효 시간<select name="duration" className="min-h-11 rounded-lg border border-line px-3" disabled={busy || uncertain || !canIssue} defaultValue="900"><option value="300">5분</option><option value="900">15분</option><option value="3600">1시간</option></select></label>
      <label className="flex flex-col gap-2">발급 사유<input name="reason" className="min-h-11 rounded-lg border border-line px-3" required minLength={1} maxLength={200} disabled={busy || uncertain || !canIssue} /></label>
      {uncertain && <p role="status">직전 요청의 결과가 확인되지 않았습니다. 재시도 시 동일한 요청을 확인합니다.</p>}
      <Button type="submit" disabled={busy || (!uncertain && !canIssue)}>{busy ? '서버 확인 중' : uncertain ? '동일 요청 다시 확인' : '내 계정에 임시 권한 발급'}</Button>
    </form>
    <h2 className="text-lg font-medium">발급 내역</h2>{data.grants.length === 0 ? <p>발급된 임시 권한이 없습니다.</p> : <ul className="flex flex-col gap-4">{data.grants.map(grant => <li key={grant.grantId} className="rounded-xl border border-line p-4"><p>만료: <time dateTime={grant.expiresAt}>{new Date(grant.expiresAt).toLocaleString()}</time></p><p>{grant.revokedAt ? '회수됨' : Date.parse(grant.expiresAt) <= now ? '만료됨' : '유효한 발급'}</p>{!grant.revokedAt && Date.parse(grant.expiresAt) > now && <Button variant="outline" disabled={busy} onClick={() => void operation(async signal => { await api.request(`${path}/${encodeURIComponent(grant.grantId)}/revoke`, { method: 'POST', csrf: session.csrfToken, body: { reason: '관리자 페이지에서 본인 임시 권한 회수' }, signal }); await load(signal); if (!signal.aborted) invalidateSession(); })}>권한 회수</Button>}</li>)}</ul>}
    {data.next && <Button variant="outline" disabled={busy} onClick={() => void operation(signal => load(signal, data.next!))}>이전 발급 내역 더 보기</Button>}</>}
  </section>;
}
