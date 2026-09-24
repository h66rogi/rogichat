'use client';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, type Session } from '@/core/api/client';
import { useApi } from '@/core/runtime/provider';
import { Button } from '@/shared/ui/button';
import { PageSkeleton } from '@/shared/ui/page-skeleton';
import { cleanupBinding, eraseSessionOutbox, erasePendingOutbox, outboxEnvironment } from './outbox-cleanup';
import { AccountDeletionControl, AccountDeletionRecovery } from '@/features/privacy';
import { readDeletion, browserPrivacyStore } from '@/features/privacy/deletion';
import { invalidateSession } from './private-session';
import { forgetChatMemory } from '@/features/chat/chat-memory';
import { revokeChatOutboxes } from '@/features/chat/chat-controller';
import { markerMatchesBinding, logoutCleanup } from '@/core/api/logout-marker';
import { sessionBinding } from '@/core/api/session-binding';
import { LOGOUT_PENDING, clearLogoutPending, setLogoutPending, type PrivateState } from './private-session';
export function StatePanel({ title, children, retry }: { title: string; children?: ReactNode; retry?: (() => void) | undefined }) {
  return <section className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 py-10 md:px-8"><h1 className="text-[24px] font-semibold text-ink">{title}</h1><div role="status" className="text-body">{children}</div>{retry && <Button onClick={retry}>다시 확인</Button>}</section>;
}
export function PrivateGate({ state, retry, allowAccountDeletion = false }: { state: Exclude<PrivateState, { kind: 'ready' }>; retry: () => void; allowAccountDeletion?: boolean }) {
  if (state.kind === 'deletionPending') return <DeletionRecoveryGate key={state.operation} retry={retry} />;
  if (state.kind === 'linkRequired') return <LinkRequiredPanel key={state.session.csrfToken} session={state.session} allowAccountDeletion={allowAccountDeletion} />;
  if (state.kind === 'logoutPending') return <LogoutRecovery />;
  if (state.kind === 'unauthenticated') return <StatePanel title="로그인 후 이용할 수 있어요"><Button asChild><Link href="/login">SOOP으로 로그인</Link></Button></StatePanel>;
  if (state.kind === 'error') return <StatePanel title="연결을 확인할 수 없어요" retry={retry}>{state.message}</StatePanel>;
  return <PageSkeleton />;
}
function DeletionRecoveryGate({ retry }: { retry: () => void }) {
  const api = useApi(); const [phase, setPhase] = useState<'checking' | 'ready' | 'error'>('checking'); const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const marker = readDeletion(browserPrivacyStore);
        if (!marker?.outbox) throw new Error('MISSING_CLEANUP_BINDING');
        await erasePendingOutbox(api.origin, marker.outbox);
        const latest = readDeletion(browserPrivacyStore);
        if (latest?.operation !== marker.operation || latest.outbox !== marker.outbox) throw new Error('CLEANUP_CHANGED');
        if (active) setPhase('ready');
      } catch { if (active) setPhase('error'); }
    })();
    return () => { active = false; };
  }, [api, attempt]);
  if (phase !== 'ready') return <StatePanel title="계정 탈퇴 요청 확인" retry={phase === 'error' ? () => { setPhase('checking'); setAttempt(value => value + 1); } : undefined}>
    {phase === 'error' ? '이전 세션의 전송 저장소를 안전하게 정리하지 못했습니다. 복구 정보와 브라우저 저장소를 확인해 주세요. 탈퇴 완료나 취소로 판단하지 않습니다.' : '이전 세션의 전송 저장소를 확인하고 있습니다.'}</StatePanel>;
  return <AccountDeletionRecovery origin={api.origin} onResume={retry} cleanupBinding={session => cleanupBinding(api.origin, session)} onPrepare={session => eraseSessionOutbox(api.origin, session)}
    onBlocked={session => { revokeChatOutboxes(session.accountPartition, session.csrfToken); forgetChatMemory(); invalidateSession(); }} />;
}
function LogoutRecovery() {
  const api = useApi();
  const [pending, setPending] = useState(false);
  const [changed, setChanged] = useState<string | null>(null);
  const [error, setError] = useState('로그아웃이 아직 확인되지 않았습니다. 이전 계정 내용은 표시하지 않습니다.');
  const retry = async () => {
    if (pending) return;
    setPending(true);
    const marker = localStorage.getItem(LOGOUT_PENDING);
    if (!marker) { setPending(false); return; }
    try {
      const cleanup = logoutCleanup(marker);
      if (cleanup) { if (cleanup.environment !== outboxEnvironment(api.origin)) throw new Error('INVALID_ENVIRONMENT'); await erasePendingOutbox(api.origin, cleanup.sessionKey); }
      const session = await api.session();
      if (!markerMatchesBinding(marker, await sessionBinding(session.csrfToken))) {
        setChanged(marker); setError('다른 로그인 세션이 확인되었습니다. 이 세션은 로그아웃하지 않았습니다. 현재 세션을 다시 확인해 주세요.'); return;
      }
      await eraseSessionOutbox(api.origin, session);
      await api.request('/v1/auth/logout', { method: 'POST', csrf: session.csrfToken });
      clearLogoutPending(marker);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) clearLogoutPending(marker);
      else setError('로그아웃 결과를 확인하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.');
    } finally { setPending(false); }
  };
  return <StatePanel title="로그아웃 확인이 필요해요"><p>{error}</p><Button className="mt-4" disabled={pending} onClick={() => void retry()}>{pending ? '확인 중' : '로그아웃 다시 시도'}</Button>{changed && <Button className="mt-3" variant="outline" onClick={() => clearLogoutPending(changed)}>현재 로그인 상태 확인</Button>}</StatePanel>;
}
export function SoopButton({ intent = 'login', csrf }: { intent?: 'login' | 'link'; csrf?: string }) {
  const api = useApi();
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const start = async () => {
    setPending(true); setError('');
    try { window.location.assign(await api.authorize(intent, csrf)); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'SOOP 로그인에 연결하지 못했습니다. 다시 시도해 주세요.'); setPending(false); }
  };
  return <div className="flex flex-col gap-4">{intent === 'login' && <label className="flex items-start gap-3 text-[14px] text-body"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-1 size-5" /><span><Link className="underline" href="/rules">이용 안내</Link>를 확인했으며, 개인 메시지가 방장에 의해 전체 공개될 수 있음을 이해합니다. (2026-09-20)</span></label>}<Button disabled={pending || (intent === 'login' && !consent)} onClick={() => void start()}>{pending ? 'SOOP에 연결 중' : intent === 'link' ? 'SOOP 계정 연결' : 'SOOP으로 로그인'}</Button>{error && <p role="alert" className="text-danger">{error}</p>}</div>;
}

function LinkRequiredPanel({ session, allowAccountDeletion }: { session: Session; allowAccountDeletion: boolean }) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const logout = async () => {
    if (busy) return;
    setBusy(true);
    let marker: string;
    try { marker = await setLogoutPending(await sessionBinding(session.csrfToken), api.origin, session); await eraseSessionOutbox(api.origin, session); }
    catch { setBusy(false); setError('브라우저 저장소를 확인하고 다시 시도해 주세요.'); return; }
    try { await api.request('/v1/auth/logout', { method: 'POST', csrf: session.csrfToken }); clearLogoutPending(marker); }
    catch { /* Pending recovery gate remains locked. */ }
  };
  return <StatePanel title="SOOP 계정 연결이 필요해요"><SoopButton intent="link" csrf={session.csrfToken} /><Button className="mt-4" variant="outline" disabled={busy} onClick={() => void logout()}>로그아웃</Button>{error && <p role="alert">{error}</p>}{allowAccountDeletion && <AccountDeletionControl origin={api.origin} session={session} generation={0} cleanupBinding={current => cleanupBinding(api.origin, current)} onPrepare={current => eraseSessionOutbox(api.origin, current)} onBlocked={current => { revokeChatOutboxes(current.accountPartition, current.csrfToken); forgetChatMemory(); invalidateSession(); }} />}</StatePanel>;
}
