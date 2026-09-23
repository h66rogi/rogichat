'use client';
/* eslint-disable @next/next/no-img-element -- Owner supplied wardrobe images. */
import { useCallback, useEffect, useState } from 'react';
import { Plus, Shirt } from 'lucide-react';
import { useApi } from '@/core/runtime/provider';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Textarea } from '@/shared/ui/textarea';
import { DEFAULT_WARDROBE_ASPECT_RATIO, WARDROBE_ASPECT_RATIOS } from './wardrobe-types';
import type { ChannelWardrobe, ChannelWardrobeCategory, ChannelWardrobeItem } from './wardrobe-types';
import { getWardrobeAspectRatioStyle } from './wardrobe-aspect-ratio';

/** Owner controls from Meloming's WardrobeManagement, adapted to Rogichat's session transport. */
export function ChannelWardrobeManagement({onChanged}:{onChanged:()=>void}) {
  const api = useApi();
  const [wardrobe,setWardrobe] = useState<ChannelWardrobe | null>(null);
  const [csrf,setCsrf] = useState<string | null>(null);
  const [revision,setRevision] = useState(0);
  const [category,setCategory] = useState<ChannelWardrobeCategory | 'new' | null>(null);
  const [item,setItem] = useState<ChannelWardrobeItem | 'new' | null>(null);
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState('');
  const refresh = useCallback(() => {setRevision(value => value+1);onChanged();},[onChanged]);
  useEffect(() => {
    const controller = new AbortController();
    api.session(controller.signal).then(session => {
      if (controller.signal.aborted) return;
      return api.request<ChannelWardrobe>('/v1/channel/wardrobe/manage',{signal:controller.signal})
        .then(value => {if (!controller.signal.aborted) {setCsrf(session.csrfToken);setWardrobe(value);}});
    }).catch(() => {if (!controller.signal.aborted) {setCsrf(null);setWardrobe(null);}});
    return () => controller.abort();
  },[api,revision]);
  if (!csrf || !wardrobe) return null;

  const saveCategory = async (event:React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy || !category) return;
    const form = new FormData(event.currentTarget);
    const body = {name:String(form.get('name')??'').trim(),defaultAspectRatio:String(form.get('defaultAspectRatio')??DEFAULT_WARDROBE_ASPECT_RATIO),
      ...(category==='new'?{}:{isEnabled:form.get('isEnabled')==='on'})};
    setBusy(true);setNotice('');
    try {await api.request(category==='new'?'/v1/channel/wardrobe/categories':`/v1/channel/wardrobe/categories/${category.id}`,
      {method:category==='new'?'POST':'PATCH',csrf,body});setCategory(null);refresh();}
    catch {setNotice('분류를 저장하지 못했습니다.');} finally {setBusy(false);}
  };
  const deleteCategory = async () => {
    if (busy || !category || category==='new') return;
    setBusy(true);setNotice('');
    try {await api.request(`/v1/channel/wardrobe/categories/${category.id}`,{method:'DELETE',csrf});setCategory(null);refresh();}
    catch {setNotice('분류를 삭제하지 못했습니다. 분류에 항목이 있으면 먼저 옮기거나 삭제해 주세요.');} finally {setBusy(false);}
  };
  const saveItem = async (event:React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy || !item) return;
    const form = new FormData(event.currentTarget);
    const body = {title:String(form.get('title')??'').trim(),imageUrl:String(form.get('imageUrl')??'').trim(),
      categoryId:Number(form.get('categoryId')),description:String(form.get('description')??''),
      tags:String(form.get('tags')??'').split(',').map(tag=>tag.trim()).filter(Boolean),
      ...(item==='new'?{}:{isVisible:form.get('isVisible')==='on'})};
    setBusy(true);setNotice('');
    try {await api.request(item==='new'?'/v1/channel/wardrobe/items':`/v1/channel/wardrobe/items/${item.id}`,
      {method:item==='new'?'POST':'PATCH',csrf,body});setItem(null);refresh();}
    catch {setNotice('항목을 저장하지 못했습니다. 이미지 URL과 태그를 확인해 주세요.');} finally {setBusy(false);}
  };
  const deleteItem = async () => {
    if (busy || !item || item==='new') return;
    setBusy(true);setNotice('');
    try {await api.request(`/v1/channel/wardrobe/items/${item.id}`,{method:'DELETE',csrf});setItem(null);refresh();}
    catch {setNotice('항목을 삭제하지 못했습니다.');} finally {setBusy(false);}
  };
  const categories = [...wardrobe.categories].sort((a,b)=>a.order-b.order);
  const items = [...wardrobe.items].sort((a,b)=>a.order-b.order);
  return <section className="mx-auto mt-12 w-full max-w-6xl border-t border-line px-4 py-8 md:px-6">
    <header className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-[22px] font-bold">옷장 관리</h2><p className="text-[14px] text-body">의상·헤어 분류와 공개할 이미지를 관리합니다.</p></div>
      <div className="flex gap-2"><Button variant="outline" onClick={()=>setCategory('new')}><Plus className="size-4" /> 분류 추가</Button><Button disabled={!categories.length} onClick={()=>setItem('new')}><Plus className="size-4" /> 항목 추가</Button></div></header>
    <div className="mb-5 flex flex-wrap gap-2">{categories.map(row=><Button key={row.id} size="sm" variant="outline" onClick={()=>setCategory(row)}>{row.name}{row.isEnabled?'':' · 숨김'}</Button>)}</div>
    {items.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{items.map(row=>{
      const rowCategory=categories.find(value=>value.id===row.categoryId);
      return <button type="button" key={row.id} onClick={()=>setItem(row)} className="overflow-hidden rounded-md border border-line text-left">
        <div className="overflow-hidden bg-surface-soft" style={getWardrobeAspectRatioStyle(rowCategory?.defaultAspectRatio)}><img src={row.imageUrl} alt="" className="size-full object-cover" /></div>
        <div className="p-3"><strong>{row.title}</strong><p className="text-[13px] text-muted">{rowCategory?.name}{row.isVisible?'':' · 비공개'}</p></div></button>;
    })}</div> : <div className="rounded-md border border-dashed border-line py-12 text-center text-muted"><Shirt className="mx-auto mb-2 size-8" />등록된 옷장 항목이 없습니다.</div>}
    {category ? <div role="presentation" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={event=>{if(event.target===event.currentTarget)setCategory(null);}}><form role="dialog" aria-modal="true" aria-label="옷장 분류 편집" onSubmit={event=>{void saveCategory(event);}} className="w-full max-w-md space-y-4 rounded-md bg-canvas p-6"><h3 className="text-[22px] font-bold">{category==='new'?'분류 추가':'분류 수정'}</h3>
      <label className="block space-y-1">이름<Input name="name" required maxLength={40} defaultValue={category==='new'?'':category.name}/></label>
      <label className="block space-y-1">기본 이미지 비율<select name="defaultAspectRatio" defaultValue={category==='new'?DEFAULT_WARDROBE_ASPECT_RATIO:category.defaultAspectRatio} className="h-12 w-full rounded-sm border border-line bg-canvas px-3">{WARDROBE_ASPECT_RATIOS.map(ratio=><option key={ratio}>{ratio}</option>)}</select></label>
      {category!=='new'?<label className="flex gap-2"><input type="checkbox" name="isEnabled" defaultChecked={category.isEnabled}/>공개</label>:null}
      {notice?<p role="alert" className="text-danger">{notice}</p>:null}<div className="flex justify-end gap-2">{category!=='new'?<Button type="button" variant="destructive" disabled={busy} onClick={()=>{void deleteCategory();}}>삭제</Button>:null}<Button type="button" variant="outline" onClick={()=>setCategory(null)}>닫기</Button><Button type="submit" disabled={busy}>저장</Button></div></form></div>:null}
    {item ? <div role="presentation" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={event=>{if(event.target===event.currentTarget)setItem(null);}}><form role="dialog" aria-modal="true" aria-label="옷장 항목 편집" onSubmit={event=>{void saveItem(event);}} className="max-h-[90svh] w-full max-w-lg space-y-4 overflow-y-auto rounded-md bg-canvas p-6"><h3 className="text-[22px] font-bold">{item==='new'?'항목 추가':'항목 수정'}</h3>
      <label className="block space-y-1">제목<Input name="title" required maxLength={40} defaultValue={item==='new'?'':item.title}/></label>
      <label className="block space-y-1">분류<select name="categoryId" defaultValue={item==='new'?categories[0]?.id:item.categoryId} className="h-12 w-full rounded-sm border border-line bg-canvas px-3">{categories.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <label className="block space-y-1">이미지 URL<Input name="imageUrl" type="url" required maxLength={2048} defaultValue={item==='new'?'':item.imageUrl}/></label>
      <label className="block space-y-1">설명<Textarea name="description" maxLength={5000} defaultValue={item==='new'?'':item.description??''}/></label>
      <label className="block space-y-1">태그 (쉼표로 구분)<Input name="tags" defaultValue={item==='new'?'':item.tags.join(', ')}/></label>
      {item!=='new'?<label className="flex gap-2"><input type="checkbox" name="isVisible" defaultChecked={item.isVisible}/>공개</label>:null}
      {notice?<p role="alert" className="text-danger">{notice}</p>:null}<div className="flex justify-end gap-2">{item!=='new'?<Button type="button" variant="destructive" disabled={busy} onClick={()=>{void deleteItem();}}>삭제</Button>:null}<Button type="button" variant="outline" onClick={()=>setItem(null)}>닫기</Button><Button type="submit" disabled={busy}>저장</Button></div></form></div>:null}
  </section>;
}
