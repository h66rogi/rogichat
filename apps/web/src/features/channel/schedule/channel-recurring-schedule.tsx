'use client';
import { useEffect, useState } from 'react';
import { useApi } from '@/core/runtime/provider';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';

type Row={dayOfWeek:number;included:boolean;title:string;startTime:string;status:'LIVE'|'OFF';isActive:boolean};
type Saved={dayOfWeek:number;title:string;startTime:string|null;status:'LIVE'|'OFF';isActive:boolean};
const days=['일','월','화','수','목','금','토'];
const blank=():Row[]=>days.map((_,dayOfWeek)=>({dayOfWeek,included:false,title:'',startTime:'20:00',status:'LIVE',isActive:true}));

/** Weekly templates use Meloming's seven-day batch upsert contract. */
export function ChannelRecurringSchedule({csrf,onChanged}:{csrf:string;onChanged:()=>void}) {
  const api=useApi();
  const [rows,setRows]=useState<Row[]>(blank);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    api.request<{items:Saved[]}>('/v1/channel/schedule/recurring',{signal:controller.signal}).then(value=>{
      if(controller.signal.aborted)return;
      const byDay=new Map(value.items.map(item=>[item.dayOfWeek,item]));
      setRows(blank().map(row=>{
        const item=byDay.get(row.dayOfWeek);
        return item?{...row,...item,included:true,startTime:item.startTime??'20:00'}:row;
      }));
      setNotice('');
    }).catch(()=>{if(!controller.signal.aborted)setNotice('반복 일정을 불러오지 못했습니다.');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[api]);
  const edit=(day:number,patch:Partial<Row>)=>setRows(previous=>previous.map(row=>row.dayOfWeek===day?{...row,...patch}:row));
  const save=async()=>{
    if(busy)return;
    const schedules=rows.filter(row=>row.included).map(({dayOfWeek,title,startTime,status,isActive})=>({dayOfWeek,title:title.trim(),startTime:status==='OFF'?null:startTime,status,isActive}));
    if(schedules.some(row=>!row.title)){setNotice('사용할 요일의 제목을 입력해 주세요.');return;}
    setBusy(true);setNotice('');
    try {await api.request('/v1/channel/schedule/recurring',{method:'PUT',csrf,body:{schedules}});setNotice('반복 일정을 저장했습니다.');onChanged();}
    catch {setNotice('반복 일정을 저장하지 못했습니다.');}
    finally {setBusy(false);}
  };
  return <section className="mt-8 border-t border-line pt-8"><header className="mb-4"><h2 className="text-[21px] font-bold">반복 일정</h2><p className="text-[14px] text-body">매주 반복할 요일을 저장하면 앞으로 4주치 일정이 자동으로 만들어집니다.</p></header>
    {loading?<p className="text-muted">반복 일정을 불러오는 중입니다.</p>:<div className="space-y-3">{rows.map(row=><div key={row.dayOfWeek} className="grid items-center gap-2 rounded-md border border-line p-3 sm:grid-cols-[82px_minmax(0,1fr)_110px_110px_70px]">
      <label className="flex items-center gap-2"><input type="checkbox" checked={row.included} onChange={event=>edit(row.dayOfWeek,{included:event.target.checked})}/>{days[row.dayOfWeek]}요일</label>
      <Input aria-label={`${days[row.dayOfWeek]}요일 제목`} placeholder="일정 제목" maxLength={100} disabled={!row.included} value={row.title} onChange={event=>edit(row.dayOfWeek,{title:event.target.value})}/>
      <select aria-label={`${days[row.dayOfWeek]}요일 상태`} className="h-12 rounded-sm border border-line bg-canvas px-2" disabled={!row.included} value={row.status} onChange={event=>edit(row.dayOfWeek,{status:event.target.value as 'LIVE'|'OFF'})}><option value="LIVE">방송</option><option value="OFF">휴방</option></select>
      <Input aria-label={`${days[row.dayOfWeek]}요일 시작 시각`} type="time" disabled={!row.included||row.status==='OFF'} value={row.startTime} onChange={event=>edit(row.dayOfWeek,{startTime:event.target.value})}/>
      <label className="flex items-center gap-1 text-[13px]"><input type="checkbox" checked={row.isActive} disabled={!row.included} onChange={event=>edit(row.dayOfWeek,{isActive:event.target.checked})}/>활성</label>
    </div>)}</div>}
    {notice?<p role="status" className="mt-3 text-body">{notice}</p>:null}<div className="mt-4 flex justify-end"><Button disabled={busy||loading} onClick={()=>{void save();}}>반복 일정 저장</Button></div>
  </section>;
}
