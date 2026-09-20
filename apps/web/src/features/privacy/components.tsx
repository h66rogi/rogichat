'use client';
import { useEffect, useRef, useState } from 'react';
import type { Session } from '../../core/api/client';
import { forgetChatMemory } from '../chat/chat-memory';
import { invalidateSession } from '../auth/private-session';
import { Button } from '../../shared/ui/button';
import { PrivacyClient } from './client';
import { ACCOUNT_DELETION_PENDING, PRIVACY_CHANGED, DeletionFlow, browserPrivacyStore, type DeletionState } from './deletion';
import { PublicationFlow, canOfferPublication, publicationKey, type PublicationContext, type PublicationState } from './publication';

function privacyChanged() { window.dispatchEvent(new Event(PRIVACY_CHANGED)); }
function blocked(callback?: () => void) { forgetChatMemory(); callback?.(); privacyChanged(); invalidateSession(); }
const deletionText: Record<DeletionState, string> = {
  idle: '계정 탈퇴를 요청하면 계정 접근이 차단되며 본인 메시지, 연결 공개본과 첨부가 삭제 대상에 포함됩니다. 방 퇴장과 다른 작업입니다.',
  checking: '현재 로그인 계정을 확인하고 있습니다.', sending: '탈퇴 요청 결과를 확인하고 있습니다.',
  reauth: '최근 15분 이내 인증이 필요합니다. 같은 SOOP 계정으로 다시 로그인한 뒤 설정에서 확인해 주세요. 자동으로 탈퇴를 다시 요청하지 않습니다.',
  unknown: '탈퇴 요청 결과를 확인하지 못했습니다. 응답을 받지 못했어도 요청이 접수되었을 수 있습니다. 로그인 실패만으로 탈퇴 완료를 확인할 수 없습니다.',
  unavailable: '지금은 탈퇴 처리 결과를 확인할 수 없습니다. 요청이 기록되었을 수 있으므로 완료나 취소로 판단하지 않습니다.',
  blocked: '탈퇴 요청이 접수되어 계정 접근이 차단되었습니다. 데이터의 물리 삭제가 완료되었다는 뜻은 아닙니다.',
  differentAccount: '탈퇴를 요청한 계정과 현재 로그인 계정이 다르거나 로그인 세션이 바뀌었습니다. 현재 계정의 탈퇴 요청은 보내지 않았습니다.',
  ready: '같은 계정의 로그인 상태를 확인했습니다. 이전 탈퇴 요청의 취소나 실패를 뜻하지 않습니다. 다시 요청하려면 아래 내용을 확인해 주세요.',
  storageError: '복구 상태를 안전하게 저장하거나 계정을 확인할 수 없습니다. 브라우저 저장소와 연결을 확인해 주세요.',
};
export interface AccountDeletionControlProps { origin: string; session: Session; generation: number; onBlocked: () => void }
export function AccountDeletionControl(props: AccountDeletionControlProps) {
  return <DeletionForm key={JSON.stringify([props.origin, props.session.csrfToken, props.session.accountPartition, props.generation])} {...props} />;
}
function DeletionForm({ origin, session, onBlocked }: AccountDeletionControlProps) {
  const [state, setState] = useState<DeletionState>('idle');
  const [confirmed, setConfirmed] = useState(false);
  const flow = useRef<DeletionFlow | null>(null);
  const callback = useRef(onBlocked);
  useEffect(() => { callback.current = onBlocked; }, [onBlocked]);
  useEffect(() => {
    const instance = new DeletionFlow(new PrivacyClient(origin), browserPrivacyStore, setState, () => blocked(() => callback.current()));
    flow.current = instance;
    return () => { instance.dispose(); flow.current = null; };
  }, [origin]);
  const busy = state === 'sending' || state === 'checking';
  const submit = async () => { if (!confirmed) return; setConfirmed(false); await flow.current?.submit(session); privacyChanged(); };
  return <section aria-label="계정 탈퇴" className="space-y-4"><h2 className="font-semibold">계정 탈퇴</h2><p role="status">{deletionText[state]}</p>{state !== 'blocked' && <><label className="flex gap-3"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /><span>계정 접근 차단과 삭제 요청 내용을 이해하고 탈퇴를 요청합니다.</span></label><Button variant="outline" disabled={!confirmed || busy} onClick={() => void submit()}>계정 탈퇴 요청</Button></>}</section>;
}

export interface AccountDeletionRecoveryProps { origin: string; onResume: () => void; onBlocked: () => void }
/** Must mount ahead of the private gate when isAccountDeletionPending() is true. */
export function AccountDeletionRecovery({ origin, onResume, onBlocked }: AccountDeletionRecoveryProps) {
  const [state, setState] = useState<DeletionState>('checking');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const flow = useRef<DeletionFlow | null>(null);
  const callbacks = useRef({ onResume, onBlocked });
  useEffect(() => { callbacks.current = { onResume, onBlocked }; }, [onResume, onBlocked]);
  useEffect(() => {
    const instance = new DeletionFlow(new PrivacyClient(origin), browserPrivacyStore, setState, () => blocked(callbacks.current.onBlocked));
    flow.current = instance;
    const recover = () => { void instance.recover(); };
    const reset = () => { instance.dispose(); setConsent(false); setEpoch(value => value + 1); };
    const changed = (event: StorageEvent) => { if (event.key === ACCOUNT_DELETION_PENDING || event.key === null) { reset(); privacyChanged(); } };
    const hide = () => { instance.dispose(); setState('unknown'); setConsent(false); };
    const visibility = () => document.visibilityState === 'hidden' ? hide() : reset();
    const initial = window.setTimeout(recover, 0);
    window.addEventListener('storage', changed);
    window.addEventListener('pagehide', hide); window.addEventListener('pageshow', reset);
    document.addEventListener('visibilitychange', visibility);
    return () => { window.clearTimeout(initial); window.removeEventListener('storage', changed); window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', reset); document.removeEventListener('visibilitychange', visibility); instance.dispose(); flow.current = null; };
  }, [origin, epoch]);
  const resume = () => {
    try {
      if (flow.current?.dismiss()) { privacyChanged(); callbacks.current.onResume(); }
    } catch { setState('storageError'); }
  };
  const retry = async () => {
    if (!consent || busy) return;
    setBusy(true); setConsent(false);
    try {
      await flow.current?.retry();
    } catch { setState('unknown'); }
    finally { setBusy(false); }
  };
  const login = async () => {
    if (!consent || busy) return;
    setBusy(true);
    const url = await flow.current?.login();
    if (url) window.location.assign(url);
    else setBusy(false);
  };
  return <section aria-label="계정 탈퇴 요청 확인" className="mx-auto max-w-xl space-y-4 px-4 py-10"><h1 className="text-xl font-semibold">계정 탈퇴 요청 확인</h1><p role="status">{deletionText[state]}</p>{!['blocked', 'checking', 'sending'].includes(state) && <>
    <Button disabled={busy} variant="outline" onClick={() => void flow.current?.recover()}>로그인 상태 다시 확인</Button>
    <label className="flex gap-3"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} /><span>{state === 'ready' ? '이전 요청이 접수되었을 수 있음을 이해하며 같은 계정의 탈퇴를 다시 요청합니다.' : <>같은 SOOP 계정으로 로그인합니다. <a href="/rules" className="underline">이용 안내</a>(2026-09-20)를 확인했으며 개인 메시지가 방장에 의해 전체 공개될 수 있음을 이해합니다.</>}</span></label>
    {state === 'ready' ? <Button disabled={!consent || busy} onClick={() => void retry()}>탈퇴 다시 요청</Button> : <Button disabled={!consent || busy} onClick={() => void login()}>같은 SOOP 계정으로 다시 로그인</Button>}
  </>}{['ready', 'differentAccount', 'blocked', 'storageError'].includes(state) && <><p>이 화면을 닫아도 이미 접수된 탈퇴 요청은 취소되지 않습니다.</p><Button variant="outline" disabled={busy} onClick={resume}>확인 화면 닫고 로그인 상태 확인</Button></>}</section>;
}

const publicationText: Record<PublicationState, string> = {
  idle: '개인 메시지를 이 방의 열람 권한이 있는 참여자에게 익명으로 공개합니다. 본문 내용으로 작성자가 추측될 수 있습니다.',
  sending: '공개 요청 결과를 확인하고 있습니다.', preparing: '공개 준비 중입니다. 아직 공개 완료가 아닙니다.',
  published: '공개가 확인되었습니다. 최신 대화를 다시 불러옵니다.', revoked: '공개가 철회되었습니다.',
  unknown: '공개 결과를 확인하지 못했습니다. 요청을 자동으로 다시 보내지 않습니다.', unavailable: '로그인이나 공개 권한을 다시 확인해 주세요.',
};
export interface PublicationControlProps extends PublicationContext { origin: string; onPublished: () => void }
export function PublicationControl(props: PublicationControlProps) {
  if (!canOfferPublication(props)) return null;
  return <PublicationForm key={publicationKey(props)} {...props} />;
}
function PublicationForm(props: PublicationControlProps) {
  const [state, setState] = useState<PublicationState>('idle');
  const [confirmed, setConfirmed] = useState(false);
  const [canCheck, setCanCheck] = useState(false);
  const flow = useRef<PublicationFlow | null>(null);
  const latest = useRef(props);
  useEffect(() => { latest.current = props; }, [props]);
  useEffect(() => {
    const initial = latest.current;
    const instance = new PublicationFlow(new PrivacyClient(initial.origin), initial, state => { setState(state); setCanCheck(instance.canCheck); }, () => latest.current.onPublished());
    flow.current = instance;
    let polls = 0;
    const timer = window.setInterval(() => { if (instance.state === 'preparing' && polls < 5) { polls++; void instance.check(); } }, 2000);
    return () => { window.clearInterval(timer); instance.dispose(); flow.current = null; };
  }, []);
  return <div className="space-y-3" aria-label="개인 메시지 익명 공개"><p role="status">{publicationText[state]}</p>{state === 'idle' && <><label className="flex gap-3"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>이 메시지의 방 전체 공개 범위를 확인했습니다.</span></label><Button variant="outline" disabled={!confirmed} onClick={() => void flow.current?.publish(confirmed)}>익명으로 전체 공개</Button></>}{(state === 'preparing' || state === 'unknown') && canCheck && <Button variant="outline" onClick={() => void flow.current?.check()}>공개 상태 다시 확인</Button>}</div>;
}
export function ModerationUnavailable() {
  return <section aria-label="신고 및 차단" className="space-y-3"><h2 className="font-semibold">신고 및 차단</h2><p>현재 신고 접수와 사용자 차단을 이용할 수 없습니다. 이 화면에서 신고가 전송되거나 사용자가 차단되지는 않습니다.</p></section>;
}
