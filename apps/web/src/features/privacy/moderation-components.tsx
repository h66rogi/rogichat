'use client';
import { useEffect, useRef, useState } from 'react';
import { AlertDialog, Dialog } from 'radix-ui';
import { Flag, UserRoundX } from 'lucide-react';
import type { Session } from '../../core/api/client';
import { Button } from '../../shared/ui/button';
import { actionDialogContentClass, actionDialogFooterClass, actionDialogOverlayClass, actionMenuItemClass } from '../../shared/ui/action-dialog';
import { PrivacyClient } from './client';
import { browserPrivacyStore } from './deletion';
import { publicationKey, type PublicationContext } from './publication';
import { BlockFlow, ReportFlow, REPORT_PENDING, blockTarget, type BlockState, type ReportState } from './moderation';
import { REPORT_REASONS, type BlockPage, type ReportReason } from './moderation-contract';

const reasons: Record<ReportReason, string> = { spam: '스팸', harassment: '괴롭힘', sexual: '성적 콘텐츠', violence: '폭력', other: '기타' };
const reportText: Record<ReportState, string> = {
  idle: '', sending: '신고하고 있어요.', received: '신고가 접수됐어요.',
  resolved: '신고가 처리됐어요.', dismissed: '신고가 종료됐어요.',
  unknown: '신고 여부를 확인할 수 없어요. 다시 확인해 주세요.', missing: '신고 여부를 확인할 수 없어요. 다시 확인해 주세요.',
  differentAccount: '현재 계정에서는 이전 신고를 확인할 수 없어요.', pendingExisting: '이전 신고를 확인한 뒤 다시 시도해 주세요.',
  storageError: '지금은 신고할 수 없어요. 잠시 후 다시 시도해 주세요.',
};
const blockText: Record<BlockState, string> = { idle: '이 방에서 서로의 메시지와 알림을 주고받지 않게 됩니다. 기존 메시지는 삭제되지 않습니다.', checking: '차단하고 있어요.', blocked: '차단했어요.', unblocked: '차단을 해제했어요.', unknown: '차단 여부를 확인할 수 없어요. 차단 목록을 확인해 주세요.' };
export interface MessageModerationControlProps extends PublicationContext { origin: string; onReset: () => void }
export function MessageModerationControl(props: MessageModerationControlProps) {
  return <MessageModerationForm key={publicationKey(props)} {...props} />;
}
function MessageModerationForm(props: MessageModerationControlProps) {
  const [state, setState] = useState<ReportState>('idle');
  const [blocking, setBlocking] = useState<BlockState>('idle');
  const [reason, setReason] = useState<ReportReason>('spam');
  const [detail, setDetail] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
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
  const content = props.message.content;
  const preview = content.type === 'TEXT' ? content.text ?? '내용을 볼 수 없는 메시지' :
    content.type === 'PHOTO' ? `사진${content.caption ? ` · ${content.caption}` : ''}` :
    content.type === 'VIDEO' ? `동영상${content.caption ? ` · ${content.caption}` : ''}` : '스티커';
  return <div aria-label="메시지 신고 및 차단">
    <Dialog.Root open={reportOpen} onOpenChange={next => { if (state !== 'sending') setReportOpen(next); }}>
      <Dialog.Trigger asChild><button type="button" className={actionMenuItemClass}><Flag className="size-4" aria-hidden="true" />메시지 신고</button></Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={actionDialogOverlayClass} />
        <Dialog.Content className={actionDialogContentClass} aria-busy={state === 'sending'}>
          <Dialog.Title className="text-lg font-semibold text-ink">메시지 신고</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-muted">{props.scope.name} 대화에서 아래 메시지를 신고합니다.</Dialog.Description>
          <blockquote className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-soft p-3 text-sm text-body">{preview}</blockquote>
          <p className="mt-2 text-xs leading-5 text-muted">신고 사유와 직접 적은 상세 내용, 이 메시지의 위치가 전달됩니다. 주변 대화와 메시지 본문은 상세 내용에 자동으로 추가되지 않습니다.</p>
          {state === 'idle' ? <form className="mt-5 space-y-4" onSubmit={event => { event.preventDefault(); void report.current?.submit(props.scope.roomId, props.message.id, reason, detail); }}>
            <label className="block text-sm font-medium text-ink">신고 사유<select className="mt-2 min-h-11 w-full rounded-lg border border-line bg-canvas px-3 text-ink focus-visible:outline-2 focus-visible:outline-focus-ring" value={reason} onChange={event => setReason(event.target.value as ReportReason)}>{REPORT_REASONS.map(value => <option key={value} value={value}>{reasons[value]}</option>)}</select></label>
            <label className="block text-sm font-medium text-ink">상세 내용 (선택, 최대 1,000자)<textarea className="mt-2 min-h-28 w-full resize-y rounded-lg border border-line bg-canvas p-3 text-ink focus-visible:outline-2 focus-visible:outline-focus-ring" maxLength={2000} value={detail} onChange={event => setDetail([...event.target.value].slice(0, 1000).join(''))} /></label>
            <p className="text-xs leading-5 text-muted">민감한 개인정보는 적지 마세요. 상세 내용은 최대 24시간 보관됩니다.</p>
            <div className={actionDialogFooterClass}><Dialog.Close asChild><Button type="button" variant="outline">취소</Button></Dialog.Close><Button type="submit">신고 제출</Button></div>
          </form> : <div className="mt-5 space-y-4"><p role="status" className="text-sm leading-6 text-body">{reportText[state]}</p>
            {['unknown', 'missing', 'storageError'].includes(state) && <Button variant="outline" onClick={() => void report.current?.recover()}>다시 확인</Button>}
            {['storageError', 'pendingExisting'].includes(state) && <a className="block text-sm underline" href="/settings">설정에서 신고 확인</a>}
            {canRetry && <Button variant="outline" onClick={() => void report.current?.retry(props.scope.roomId, props.message.id)}>신고 다시 제출</Button>}
            <div className={actionDialogFooterClass}><Dialog.Close asChild><Button type="button" variant="outline" disabled={state === 'sending'}>닫기</Button></Dialog.Close></div>
          </div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    {target && <AlertDialog.Root open={blockOpen} onOpenChange={next => { if (blocking !== 'checking') setBlockOpen(next); }}>
      <AlertDialog.Trigger asChild><button type="button" className={actionMenuItemClass}><UserRoundX className="size-4" aria-hidden="true" />이 사용자 차단</button></AlertDialog.Trigger>
      <AlertDialog.Portal><AlertDialog.Overlay className={actionDialogOverlayClass} /><AlertDialog.Content className={actionDialogContentClass} aria-busy={blocking === 'checking'}>
        <AlertDialog.Title className="text-lg font-semibold text-ink">이 사용자를 차단할까요?</AlertDialog.Title>
        <AlertDialog.Description className="mt-3 text-sm leading-6 text-muted">{blockText.idle}</AlertDialog.Description>
        {blocking !== 'idle' && <p role="status" className="mt-4 text-sm text-body">{blockText[blocking]}</p>}
        <div className={actionDialogFooterClass}><AlertDialog.Cancel asChild><Button variant="outline" disabled={blocking === 'checking'}>취소</Button></AlertDialog.Cancel>{blocking === 'idle' && <Button onClick={() => void block.current?.change(props.scope.roomId, target, true)}>사용자 차단</Button>}</div>
      </AlertDialog.Content></AlertDialog.Portal>
    </AlertDialog.Root>}
  </div>;
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
  useEffect(() => {
    if (!['received', 'resolved', 'dismissed'].includes(state)) return;
    const timer = window.setTimeout(() => setState('idle'), 5000);
    return () => window.clearTimeout(timer);
  }, [state]);
  if (state === 'idle') return null;
  if (['received', 'resolved', 'dismissed'].includes(state)) return <p role="status">{reportText[state]}</p>;
  return <section aria-label="이전 신고 확인" className="space-y-3"><h2 className="font-semibold">이전 신고 확인</h2><p role="status">{reportText[state]}</p>{['unknown', 'missing', 'differentAccount', 'storageError'].includes(state) && <Button variant="outline" onClick={() => void flow.current?.recover()}>다시 확인</Button>}{['missing', 'differentAccount'].includes(state) && <><p>이 안내를 닫아도 이미 접수된 신고는 취소되지 않아요.</p><Button variant="outline" onClick={() => flow.current?.dismiss()}>안내 닫기</Button></>}</section>;
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
  return <section aria-label="차단한 사용자" className="space-y-3"><h2 className="font-semibold">차단한 사용자</h2><p>차단을 해제해도 이전 방 참여 권한은 자동으로 복구되지 않아요.</p><p role="status">{blockText[state]}</p><Button variant="outline" disabled={loading} onClick={() => void load(null)}>차단 목록 확인</Button>{error && <p role="alert">차단 목록을 확인하지 못했습니다. 다시 시도해 주세요.</p>}{page && <>{page.blocks.length === 0 && <p>이 페이지에 차단한 사용자가 없습니다.</p>}<ul>{page.blocks.map((row, index) => <li key={row.actorId} className="space-y-2 py-2"><span>{row.displayName ?? '이름을 확인할 수 없음'} · {new Date(row.blockedAt).toLocaleString('ko-KR')}</span><AlertDialog.Root open={selected === row.actorId} onOpenChange={next => { if (state !== 'checking') setSelected(next ? row.actorId : null); }}><AlertDialog.Trigger asChild><Button variant="outline" className="ml-2">{row.displayName ?? `차단한 사용자 ${index + 1}`} 차단 해제</Button></AlertDialog.Trigger><AlertDialog.Portal><AlertDialog.Overlay className={actionDialogOverlayClass} /><AlertDialog.Content className={actionDialogContentClass} aria-busy={state === 'checking'}><AlertDialog.Title className="text-lg font-semibold text-ink">차단을 해제할까요?</AlertDialog.Title><AlertDialog.Description className="mt-3 text-sm leading-6 text-muted">{row.displayName ?? `차단한 사용자 ${index + 1}`}의 차단을 해제합니다. 이전 방 참여 권한은 자동으로 복구되지 않습니다.</AlertDialog.Description><div className={actionDialogFooterClass}><AlertDialog.Cancel asChild><Button variant="outline" disabled={state === 'checking'}>취소</Button></AlertDialog.Cancel><Button disabled={state === 'checking'} onClick={() => { setPage(null); setSelected(null); void flow.current?.change(props.roomId, row.actorId, false); }}>차단 해제 확인</Button></div></AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root></li>)}</ul>{page.next && <Button disabled={loading} variant="outline" onClick={() => void load(page.next)}>다음 차단 목록</Button>}</>}</section>;
}
