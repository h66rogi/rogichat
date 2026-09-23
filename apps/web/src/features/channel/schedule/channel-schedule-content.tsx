'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useApi } from '@/core/runtime/provider';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Textarea } from '@/shared/ui/textarea';
import { ScheduleCardDesktop } from './ScheduleCardDesktop';
import { ScheduleCardMobile } from './ScheduleCardMobile';
import type { Schedule, ScheduleStatus, ScheduleVisibility } from './schedule-types';
import { getNextWeek, getPreviousWeek, getWeekEnd, getWeekStart } from './week-utils';
import { ChannelRecurringSchedule } from './channel-recurring-schedule';

type List = { items: Schedule[]; page: number; limit: number; total: number };
const statuses: {value:ScheduleStatus;label:string}[] = [
  {value:'LIVE',label:'방송'},{value:'COLLAB',label:'합방'},{value:'OFF',label:'휴방'},
  {value:'ETC',label:'기타'},{value:'TBD',label:'미정'},
];
function localValue(iso: string) {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime()-offset).toISOString().slice(0,16);
}
function dayKey(value: string | Date) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

/** Uses the Meloming Schedule type, status styles, cards and week navigation. */
export function ChannelScheduleContent() {
  const api = useApi();
  const [weekStart,setWeekStart] = useState(() => getWeekStart(new Date()));
  const [items,setItems] = useState<Schedule[]>([]);
  const [csrf,setCsrf] = useState<string | null>(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState<string | null>(null);
  const [revision,setRevision] = useState(0);
  const [editing,setEditing] = useState<Schedule | 'new' | null>(null);
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState('');
  const refresh = useCallback(() => { setLoading(true); setRevision(value => value+1); },[]);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({from:weekStart,to:getWeekEnd(new Date(weekStart)),limit:'100'});
    (async () => {
      let path = `/v1/channel/schedule?${params}`;
      try {
        const session = await api.session(controller.signal);
        try {
          const managed = await api.request<List>(`/v1/channel/schedule/manage?${params}`,{signal:controller.signal});
          if (!controller.signal.aborted) { setItems(managed.items); setCsrf(session.csrfToken); setError(null); }
          return;
        } catch { path = `/v1/channel/schedule?${params}`; }
      } catch { /* Anonymous readers use the public schedule. */ }
      const publicList = await api.request<List>(path,{signal:controller.signal});
      if (!controller.signal.aborted) { setItems(publicList.items); setCsrf(null); setError(null); }
    })().catch(() => { if (!controller.signal.aborted) setError('일정을 불러오지 못했습니다.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  },[api,weekStart,revision]);

  const days = useMemo(() => Array.from({length:7},(_,index) => {
    const day = new Date(weekStart); day.setDate(day.getDate()+index); return day;
  }),[weekStart]);
  const byDay = useMemo(() => {
    const grouped = new Map<string,Schedule[]>();
    for (const day of days) grouped.set(dayKey(day),[]);
    for (const event of items) {
      if (event.isCanceled) continue;
      const start = new Date(event.startAt);
      const end = event.endAt ? new Date(event.endAt) : start;
      for (const day of days) {
        const from = new Date(day); from.setHours(0,0,0,0);
        const to = new Date(day); to.setHours(23,59,59,999);
        if (start <= to && end >= from) grouped.get(dayKey(day))?.push(event);
      }
    }
    for (const events of grouped.values()) events.sort((a,b) => a.startAt.localeCompare(b.startAt));
    return grouped;
  },[days,items]);

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!csrf || busy) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') ?? '').trim();
    const date = String(form.get('startAt') ?? '');
    if (!title || !date) return;
    setBusy(true); setNotice('');
    try {
      const body = {title,content:String(form.get('content') ?? '').trim(),startAt:new Date(date).toISOString(),
        status:String(form.get('status') ?? 'TBD') as ScheduleStatus,
        visibility:String(form.get('visibility') ?? 'PUBLIC') as ScheduleVisibility};
      const path = editing === 'new' ? '/v1/channel/schedule' : `/v1/channel/schedule/${editing?.id}`;
      await api.request(path,{method:editing === 'new' ? 'POST' : 'PATCH',csrf,body});
      setEditing(null); refresh();
    } catch { setNotice('일정을 저장하지 못했습니다. 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!csrf || !editing || editing === 'new' || busy) return;
    setBusy(true); setNotice('');
    try { await api.request(`/v1/channel/schedule/${editing.id}`,{method:'DELETE',csrf}); setEditing(null); refresh(); }
    catch { setNotice('일정을 삭제하지 못했습니다. 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  };

  return <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-8 md:py-12">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div><h1 className="text-[28px] font-bold text-ink">일정</h1><p className="text-body">후로기의 방송 일정을 확인해 보세요.</p></div>
      {csrf ? <Button onClick={() => setEditing('new')}><Plus className="size-5" /> 일정 추가</Button> : null}
    </header>
    <div className="flex items-center justify-between gap-4">
      <Button variant="outline" size="sm" onClick={() => setWeekStart(getPreviousWeek(weekStart))} aria-label="이전 주"><ChevronLeft /></Button>
      <strong className="text-center text-ink">{days[0]?.toLocaleDateString('ko-KR',{month:'long',day:'numeric'})} – {days[6]?.toLocaleDateString('ko-KR',{month:'long',day:'numeric'})}</strong>
      <Button variant="outline" size="sm" onClick={() => setWeekStart(getNextWeek(weekStart))} aria-label="다음 주"><ChevronRight /></Button>
    </div>
    {error ? <div role="alert" className="rounded-md border border-danger p-4">{error} <Button size="sm" variant="outline" onClick={refresh}>다시 시도</Button></div> : null}
    {loading ? <p className="text-muted">일정을 불러오는 중입니다.</p> : <>
      <div className="hidden grid-cols-7 gap-3 md:grid">
        {days.map(day => <div key={dayKey(day)} className="min-w-0 space-y-3">
          <h2 className="border-b border-line pb-2 text-center font-semibold">{day.toLocaleDateString('ko-KR',{weekday:'short',month:'numeric',day:'numeric'})}</h2>
          {(byDay.get(dayKey(day)) ?? []).map(item => <ScheduleCardDesktop key={item.id} schedule={item} hideChannel onClick={() => setEditing(item)} />)}
          {(byDay.get(dayKey(day)) ?? []).length === 0 ? <p className="py-5 text-center text-[13px] text-muted">일정 없음</p> : null}
        </div>)}
      </div>
      <div className="space-y-6 md:hidden">{days.map(day => <div key={dayKey(day)}>
        <h2 className="mb-2 border-b border-line pb-2 font-semibold">{day.toLocaleDateString('ko-KR',{weekday:'long',month:'long',day:'numeric'})}</h2>
        <div className="space-y-2">{(byDay.get(dayKey(day)) ?? []).map(item => <ScheduleCardMobile key={item.id} schedule={item} hideChannel onClick={() => setEditing(item)} />)}
          {(byDay.get(dayKey(day)) ?? []).length === 0 ? <p className="text-[14px] text-muted">일정 없음</p> : null}</div>
      </div>)}</div>
    </>}
    {csrf ? <ChannelRecurringSchedule csrf={csrf} onChanged={refresh} /> : null}
    {editing ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setEditing(null); }}>
      <div role="dialog" aria-modal="true" aria-label={editing === 'new' ? '일정 추가' : '일정 상세'} className="max-h-[90svh] w-full max-w-lg overflow-y-auto rounded-md bg-canvas p-6 shadow-xl">
        {csrf ? <form onSubmit={event => {void save(event);}} className="space-y-4">
          <h2 className="text-[22px] font-bold">{editing === 'new' ? '일정 추가' : '일정 수정'}</h2>
          <label className="block space-y-1">제목<Input name="title" maxLength={100} required defaultValue={editing === 'new' ? '' : editing.title} /></label>
          <label className="block space-y-1">시작 시각<Input name="startAt" type="datetime-local" required defaultValue={editing === 'new' ? localValue(new Date().toISOString()) : localValue(editing.startAt)} /></label>
          <label className="block space-y-1">내용<Textarea name="content" defaultValue={editing === 'new' ? '' : editing.content ?? ''} /></label>
          <label className="block space-y-1">상태<select name="status" defaultValue={editing === 'new' ? 'TBD' : editing.status} className="h-12 w-full rounded-sm border border-line bg-canvas px-3">
            {statuses.map(status => <option key={status.value} value={status.value}>{status.label}</option>)}</select></label>
          <label className="block space-y-1">공개 범위<select name="visibility" defaultValue={editing === 'new' ? 'PUBLIC' : editing.visibility} className="h-12 w-full rounded-sm border border-line bg-canvas px-3"><option value="PUBLIC">공개</option><option value="PRIVATE">비공개</option></select></label>
          {notice ? <p role="alert" className="text-danger">{notice}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">{editing !== 'new' ? <Button type="button" variant="destructive" disabled={busy} onClick={() => {void remove();}}>삭제</Button> : null}<Button type="button" variant="outline" onClick={() => setEditing(null)}>닫기</Button><Button type="submit" disabled={busy}>저장</Button></div>
        </form> : <div className="space-y-4"><h2 className="text-[22px] font-bold">{editing === 'new' ? '' : editing.title}</h2>
          {editing !== 'new' ? <><p>{new Date(editing.startAt).toLocaleString('ko-KR')}</p><p className="whitespace-pre-wrap">{editing.content}</p></> : null}
          <Button onClick={() => setEditing(null)}>닫기</Button></div>}
      </div>
    </div> : null}
  </section>;
}
