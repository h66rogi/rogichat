'use client';
import { useEffect, useRef, useState } from 'react';
import type { Session } from '../../core/api/client';
import { Button } from '../../shared/ui/button';
import { PrivacyClient } from './client';
import { browserPrivacyStore } from './deletion';
import { publicationKey, type PublicationContext } from './publication';
import { BlockFlow, ReportFlow, REPORT_PENDING, blockTarget, type BlockState, type ReportState } from './moderation';
import { REPORT_REASONS, type BlockPage, type ReportReason } from './moderation-contract';

const reasons: Record<ReportReason, string> = { spam: '스팸', harassment: '괴롭힘', sexual: '성적 콘텐츠', violence: '폭력', other: '기타' };
const reportText: Record<ReportState, string> = {
  idle: '현재 열람할 수 있는 메시지를 신고할 수 있습니다. 메시지 본문은 신고 양식에 자동 복사하지 않습니다.',
  sending: '신고 접수 결과를 확인하고 있습니다.', received: '신고가 저장되었습니다. 담당자의 확인이나 연락이 시작되었다는 뜻은 아닙니다.',
  resolved: '이 신고는 처리된 상태입니다. 메시지 삭제나 사용자 차단을 뜻하지는 않습니다.', dismissed: '이 신고는 종결된 상태입니다.',
  unknown: '신고 접수 여부를 확인하지 못했습니다. 접수 상태를 다시 확인해 주세요.', missing: '저장된 신고 접수증을 찾지 못했습니다. 자동으로 다시 신고하지 않습니다.',
  differentAccount: '이전 신고와 다른 계정입니다. 이전 계정의 신고 정보는 조회하지 않았습니다.', pendingExisting: '확인이 필요한 이전 신고가 있습니다. 설정에서 신고 접수 상태를 확인해 주세요.',
  storageError: '신고 복구 상태를 저장하거나 로그인 상태를 확인할 수 없습니다. 다시 확인해 주세요.',
};
const blockText: Record<BlockState, string> = { idle: '이 방에서 상대의 메시지 열람을 제한하고 양방향 직접 메시지와 알림을 막습니다. 강퇴나 메시지 삭제와 다릅니다.', checking: '차단 상태 변경을 확인하고 있습니다.', blocked: '차단이 확인되었습니다. 방의 접근 상태를 다시 확인합니다.', unblocked: '차단 해제가 확인되었습니다. 이전 참여 권한이 복원되는 것은 아닙니다.', unknown: '차단 변경 결과를 확인하지 못했습니다. 설정의 차단 목록을 다시 확인해 주세요.' };
export interface MessageModerationControlProps extends PublicationContext { origin: string; onReset: () => void }
export function MessageModerationControl(props: MessageModerationControlProps) {
  return <MessageModerationForm key={publicationKey(props)} {...props} />;
}
function MessageModerationForm(props: MessageModerationControlProps) {
  const [state, setState] = useState<ReportState>('idle');
  const [blocking, setBlocking] = useState<BlockState>('idle');
  const [reason, setReason] = useState<ReportReason>('spam');
  const [detail, setDetail] = useState('');
  const [confirmReport, setConfirmReport] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [canRetry, setCanRetry] = useState(false);
  const report = useRef<ReportFlow | null>(null); const block = useRef<BlockFlow | null>(null);
  const latest = useRef(props); useEffect(() => { latest.current = props; }, [props]);
  useEffect(() => {
    const p = latest.current; const api = new PrivacyClient(p.origin);
    const reporter = new ReportFlow(api, browserPrivacyStore, p.session, state => { setState(state); setCanRetry(reporter.canRetry); if (['received', 'resolved', 'dismissed'].includes(state)) setDetail(''); });
    const blocker = new BlockFlow(api, p.session, setBlocking, () => latest.current.onReset()); report.current = reporter; block.current = blocker;
    return () => { reporter.dispose(); blocker.dispose(); report.current = null; block.current = null; };
  }, []);
  const target = blockTarget(props.message, props.scope.actorId);
  return <div className="space-y-4" aria-label="메시지 신고 및 차단"><details><summary className="cursor-pointer">메시지 신고</summary><div className="space-y-3 pt-3"><p role="status">{reportText[state]}</p>{state === 'idle' && <>
    <label className="block">신고 사유<select className="ml-2 rounded border p-2" value={reason} onChange={event => setReason(event.target.value as ReportReason)}>{REPORT_REASONS.map(value => <option key={value} value={value}>{reasons[value]}</option>)}</select></label>
    <label className="block">상세 내용 (선택, 최대 1,000자)<textarea className="mt-2 block w-full rounded border p-2" maxLength={2000} value={detail} onChange={event => setDetail([...event.target.value].slice(0, 1000).join(''))} /></label>
    <p>민감한 개인정보는 적지 마세요. 입력한 상세 내용은 서버에서 최대 24시간 보관합니다.</p>
    <label className="flex gap-3"><input type="checkbox" checked={confirmReport} onChange={event => setConfirmReport(event.target.checked)} /><span>선택한 사유와 내용을 신고로 제출합니다.</span></label>
    <Button disabled={!confirmReport} onClick={() => { setConfirmReport(false); void report.current?.submit(props.scope.roomId, props.message.id, reason, detail); }}>신고 제출</Button>
  </>}{['unknown', 'missing', 'storageError'].includes(state) && <Button variant="outline" onClick={() => void report.current?.recover()}>신고 접수 확인</Button>}{['storageError', 'pendingExisting'].includes(state) && <a className="block underline" href="/settings">설정에서 신고 확인 기록 관리</a>}{canRetry && <Button variant="outline" onClick={() => void report.current?.retry(props.scope.roomId, props.message.id)}>동일한 신고 다시 제출</Button>}</div></details>
  {target && <details><summary className="cursor-pointer">이 사용자 차단</summary><div className="space-y-3 pt-3"><p role="status">{blockText[blocking]}</p>{blocking === 'idle' && <><label className="flex gap-3"><input type="checkbox" checked={confirmBlock} onChange={event => setConfirmBlock(event.target.checked)} /><span>이 방에서 해당 사용자를 차단합니다.</span></label><Button variant="outline" disabled={!confirmBlock} onClick={() => { setConfirmBlock(false); void block.current?.change(props.scope.roomId, target, true); }}>사용자 차단</Button></>}</div></details>}</div>;
}

export interface ReportRecoveryProps { origin: string; session: Session; generation: number }
export function ReportRecovery(props: ReportRecoveryProps) { return <ReportRecoveryForm key={JSON.stringify([props.origin, props.session.accountPartition, props.session.csrfToken, props.generation])} {...props} />; }
function ReportRecoveryForm({ origin, session }: ReportRecoveryProps) {
  const [state, setState] = useState<ReportState>('idle');
  const flow = useRef<ReportFlow | null>(null);
  useEffect(() => {
    const instance = new ReportFlow(new PrivacyClient(origin), browserPrivacyStore, session, setState); flow.current = instance;
    const timer = window.setTimeout(() => void instance.recover(), 0);
    const changed = (event: StorageEvent) => { if (event.key === REPORT_PENDING || event.key === null) void instance.recover(); };
    window.addEventListener('storage', changed);
    return () => { window.clearTimeout(timer); window.removeEventListener('storage', changed); instance.dispose(); flow.current = null; };
  }, [origin, session]);
  if (state === 'idle') return null;
  return <section aria-label="이전 신고 접수 확인" className="space-y-3"><h2 className="font-semibold">이전 신고 접수 확인</h2><p role="status">{reportText[state]}</p>{['unknown', 'missing', 'differentAccount', 'storageError'].includes(state) && <Button variant="outline" onClick={() => void flow.current?.recover()}>신고 접수 상태 다시 확인</Button>}{['missing', 'differentAccount', 'storageError'].includes(state) && <><p>확인 기록을 지워도 이미 서버에 접수된 신고는 취소되지 않습니다. 신고 내용은 이 브라우저에 저장하지 않아 자동 재제출할 수 없습니다.</p><Button variant="outline" onClick={() => flow.current?.dismiss()}>이 브라우저의 신고 확인 기록 지우기</Button></>}</section>;
}

export interface BlockedActorsControlProps { origin: string; session: Session; roomId: string; generation: number; onReset: () => void }
export function BlockedActorsControl(props: BlockedActorsControlProps) { return <BlockedActorsForm key={JSON.stringify([props.origin, props.session.accountPartition, props.session.csrfToken, props.generation, props.roomId])} {...props} />; }
function BlockedActorsForm(props: BlockedActorsControlProps) {
  const [page, setPage] = useState<BlockPage | null>(null);
  const [error, setError] = useState(false); const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [state, setState] = useState<BlockState>('idle');
  const flow = useRef<BlockFlow | null>(null); const latest = useRef(props);
  useEffect(() => { latest.current = props; }, [props]);
  useEffect(() => {
    const p = latest.current; const instance = new BlockFlow(new PrivacyClient(p.origin), p.session, setState, () => latest.current.onReset()); flow.current = instance;
    return () => { instance.dispose(); flow.current = null; };
  }, []);
  const load = async (after: string | null) => {
    if (loading) return; setPage(null); setLoading(true); setError(false); setSelected(null);
    const current = flow.current;
    try { const result = await current?.list(props.roomId, after); if (result && flow.current === current) setPage(result); }
    catch { if (flow.current === current) setError(true); }
    finally { if (flow.current === current) setLoading(false); }
  };
  return <section aria-label="차단한 사용자" className="space-y-3"><h2 className="font-semibold">차단한 사용자</h2><p>서버가 이 차단 목록에 제공한 현재 표시 이름만 보여 드립니다. 이름을 확인할 수 없는 항목은 식별 정보와 차단 날짜로 구분합니다. 해제해도 퇴장·강퇴된 방의 참여 권한이 복구되지는 않습니다.</p><p role="status">{blockText[state]}</p><Button variant="outline" disabled={loading} onClick={() => void load(null)}>차단 목록 확인</Button>{error && <p role="alert">차단 목록을 확인하지 못했습니다. 다시 시도해 주세요.</p>}{page && <>{page.blocks.length === 0 && <p>이 페이지에 차단한 사용자가 없습니다.</p>}<ul>{page.blocks.map((row, index) => <li key={row.actorId} className="space-y-2 py-2"><span>{row.displayName ?? '표시 이름을 확인할 수 없음'} · 식별 정보 {row.actorId} · {new Date(row.blockedAt).toLocaleString('ko-KR')}</span><Button variant="outline" className="ml-2" onClick={() => setSelected(row.actorId)}>차단 항목 {index + 1} 해제</Button>{selected === row.actorId && <div><p>이 항목의 차단을 해제하시겠어요?</p><Button disabled={state === 'checking'} onClick={() => { setPage(null); setSelected(null); void flow.current?.change(props.roomId, row.actorId, false); }}>차단 해제 확인</Button><Button variant="outline" onClick={() => setSelected(null)}>취소</Button></div>}</li>)}</ul>{page.next && <Button disabled={loading} variant="outline" onClick={() => void load(page.next)}>다음 차단 목록</Button>}</>}</section>;
}
