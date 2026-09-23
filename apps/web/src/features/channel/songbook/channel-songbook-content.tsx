'use client';
/* eslint-disable @next/next/no-img-element -- Channel album art URLs are supplied by the owner. */
import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Heart, Music2, Plus, Search } from 'lucide-react';
import { useApi } from '@/core/runtime/provider';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Textarea } from '@/shared/ui/textarea';
import { SongRatingBadges } from './song-rating-badges';
import { useMusicbookFilters } from './use-musicbook-filters';
import type { Song, GetSongsChannelIdentifierResponse } from './song-types';

type Filters = {artists:{id:number;name:string}[];categories:{id:number;name:string;color:string}[]};
type SortBy = 'newest'|'oldest'|'title'|'artist'|'likes_desc';
const LIMIT = 40;

/** Meloming songbook types, URL filters, rating display and query semantics. */
export function ChannelSongbookContent() {
  const api = useApi();
  const {filters,setSearchQuery,setCategories,setArtists,setRatingFilter,clearFilters} = useMusicbookFilters();
  const [search,setSearch] = useState(filters.searchQuery);
  const [sortBy,setSortBy] = useState<SortBy>('newest');
  const [page,setPage] = useState(1);
  const [songs,setSongs] = useState<Song[]>([]);
  const [total,setTotal] = useState(0);
  const [options,setOptions] = useState<Filters>({artists:[],categories:[]});
  const [favorites,setFavorites] = useState<Set<number>>(new Set());
  const [csrf,setCsrf] = useState<string | null>(null);
  const [canManage,setCanManage] = useState(false);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState<string | null>(null);
  const [revision,setRevision] = useState(0);
  const [selected,setSelected] = useState<Song | null>(null);
  const [editing,setEditing] = useState<Song | 'new' | null>(null);
  const [categoryOpen,setCategoryOpen] = useState(false);
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setSearch(filters.searchQuery),0);
    return () => clearTimeout(timer);
  },[filters.searchQuery]);
  useEffect(() => {
    if (search.trim() === filters.searchQuery) return;
    const timer = setTimeout(() => setSearchQuery(search.trim() || undefined),300);
    return () => clearTimeout(timer);
  },[search,filters.searchQuery,setSearchQuery]);
  useEffect(() => {
    const controller = new AbortController();
    api.request<Filters>('/v1/channel/songbook/filters',{signal:controller.signal})
      .then(value => {if (!controller.signal.aborted) setOptions(value);}).catch(() => {});
    api.session(controller.signal).then(async session => {
      if (controller.signal.aborted) return;
      setCsrf(session.csrfToken);
      const [managed,liked] = await Promise.allSettled([
        api.request<{canManage:boolean}>('/v1/channel/songbook/manage',{signal:controller.signal}),
        api.request<{songIds:number[]}>('/v1/channel/songbook/favorites',{signal:controller.signal}),
      ]);
      if (!controller.signal.aborted) {
        setCanManage(managed.status === 'fulfilled' && managed.value.canManage);
        if (liked.status === 'fulfilled') setFavorites(new Set(liked.value.songIds));
      }
    }).catch(() => { if (!controller.signal.aborted) {setCsrf(null);setCanManage(false);} });
    return () => controller.abort();
  },[api,revision]);
  const categoryIds = filters.categoryIds.join(',');
  const artistIds = filters.artistIds.join(',');
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({page:String(page),limit:String(LIMIT),sortBy});
    if (filters.searchQuery) params.set('search',filters.searchQuery);
    if (categoryIds) params.set('categoryIds',categoryIds);
    if (artistIds) params.set('artistIds',artistIds);
    if (filters.difficulty) params.set('difficulties',filters.difficulty);
    api.request<GetSongsChannelIdentifierResponse>(`/v1/channel/songbook?${params}`,{signal:controller.signal})
      .then(value => {if (!controller.signal.aborted) {setSongs(value.songs);setTotal(value.total);setError(null);}})
      .catch(() => {if (!controller.signal.aborted) setError('노래책을 불러오지 못했습니다.');})
      .finally(() => {if (!controller.signal.aborted) setLoading(false);});
    return () => controller.abort();
  },[api,page,sortBy,filters.searchQuery,filters.difficulty,categoryIds,artistIds,revision]);

  const selectedCategoryIds = useMemo(() => new Set(filters.categoryIds),[filters.categoryIds]);
  const toggleFavorite = async (song: Song) => {
    if (!csrf) { setNotice('즐겨찾기는 로그인 후 이용할 수 있습니다.'); return; }
    const liked = favorites.has(song.id);
    setNotice('');
    try {
      await api.request(`/v1/channel/songbook/${song.id}/favorite`,{method:liked?'DELETE':'POST',csrf});
      setFavorites(previous => {const next = new Set(previous); if(liked) next.delete(song.id); else next.add(song.id); return next;});
    } catch {setNotice('즐겨찾기를 변경하지 못했습니다.');}
  };
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!csrf || busy) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') ?? '').trim(), artistName = String(form.get('artistName') ?? '').trim();
    if (!title || !artistName) return;
    const selectedCategories = form.getAll('categoryIds').map(Number);
    const body = {title,artistName,albumArt:String(form.get('albumArt') ?? '').trim(),
      karaokeUrl:String(form.get('karaokeUrl') ?? '').trim(),description:String(form.get('description') ?? '').trim(),
      difficulty:Number(form.get('difficulty') ?? 1),categoryIds:selectedCategories};
    const path = editing === 'new' ? '/v1/channel/songbook' : `/v1/channel/songbook/${editing?.id}`;
    setBusy(true);setNotice('');
    try {await api.request(path,{method:editing === 'new'?'POST':'PATCH',csrf,body});setEditing(null);setRevision(value => value+1);}
    catch {setNotice('노래를 저장하지 못했습니다.');}
    finally {setBusy(false);}
  };
  const remove = async () => {
    if (!csrf || !editing || editing === 'new' || busy) return;
    setBusy(true);setNotice('');
    try {await api.request(`/v1/channel/songbook/${editing.id}`,{method:'DELETE',csrf});setEditing(null);setSelected(null);setRevision(value => value+1);}
    catch {setNotice('노래를 삭제하지 못했습니다.');}
    finally {setBusy(false);}
  };
  const createCategory = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!csrf || busy) return;
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim(); if (!name) return;
    setBusy(true);setNotice('');
    try {await api.request('/v1/channel/songbook/categories',{method:'POST',csrf,body:{name}});setCategoryOpen(false);setRevision(value => value+1);}
    catch {setNotice('분류를 만들지 못했습니다.');}
    finally {setBusy(false);}
  };

  return <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-8 md:py-12">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-[28px] font-bold text-ink">노래책</h1><p className="text-body">후로기의 노래를 찾아보세요.</p></div>
      {canManage ? <div className="flex gap-2"><Button variant="outline" onClick={() => setCategoryOpen(true)}>분류 추가</Button><Button onClick={() => setEditing('new')}><Plus className="size-5" /> 노래 추가</Button></div> : null}
    </header>
    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_160px_130px_130px]">
      <label className="relative"><Search className="pointer-events-none absolute top-3.5 left-3 size-5 text-muted" /><Input aria-label="노래 검색" placeholder="노래 또는 가수 검색" value={search} onChange={event => {setSearch(event.target.value);setPage(1);setLoading(true);}} className="pl-10" /></label>
      <select aria-label="분류" className="h-12 rounded-sm border border-line bg-canvas px-3" value={filters.categoryIds[0] ?? ''} onChange={event => {setCategories(event.target.value?[event.target.value]:[]);setPage(1);setLoading(true);}}><option value="">분류 전체</option>{options.categories.map(category => <option value={category.id} key={category.id}>{category.name}</option>)}</select>
      <select aria-label="가수" className="h-12 rounded-sm border border-line bg-canvas px-3" value={filters.artistIds[0] ?? ''} onChange={event => {setArtists(event.target.value?[event.target.value]:[]);setPage(1);setLoading(true);}}><option value="">가수 전체</option>{options.artists.map(artist => <option value={artist.id} key={artist.id}>{artist.name}</option>)}</select>
      <select aria-label="난이도" className="h-12 rounded-sm border border-line bg-canvas px-3" value={filters.difficulty ?? ''} onChange={event => {setRatingFilter('difficulty',event.target.value || undefined);setPage(1);setLoading(true);}}><option value="">난이도 전체</option>{[1,2,3,4,5].map(value => <option key={value} value={value}>{value}성</option>)}</select>
      <select aria-label="정렬" className="h-12 rounded-sm border border-line bg-canvas px-3" value={sortBy} onChange={event => {setSortBy(event.target.value as SortBy);setPage(1);setLoading(true);}}><option value="newest">최신순</option><option value="oldest">오래된순</option><option value="title">제목순</option><option value="artist">가수순</option><option value="likes_desc">인기순</option></select>
    </div>
    {(filters.searchQuery || selectedCategoryIds.size || filters.artistIds.length || filters.difficulty) ? <div><Button variant="ghost" size="sm" onClick={clearFilters}>필터 초기화</Button></div> : null}
    {notice ? <p role="status" className="text-danger">{notice}</p> : null}
    {error ? <div role="alert" className="rounded-md border border-danger p-4">{error} <Button size="sm" variant="outline" onClick={() => setRevision(value => value+1)}>다시 시도</Button></div> : null}
    <p className="text-[14px] text-muted">총 {total.toLocaleString('ko-KR')}곡</p>
    {loading ? <p className="text-muted">노래책을 불러오는 중입니다.</p> : songs.length === 0 ? <div className="flex flex-col items-center gap-3 rounded-md border border-line py-16 text-muted"><BookOpen className="size-10" /><p>등록된 노래가 없습니다.</p></div>
      : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{songs.map(song => <article key={song.id} className="overflow-hidden rounded-md border border-line bg-canvas shadow-sm">
        <button type="button" className="w-full text-left" onClick={() => setSelected(song)}>
          <div className="flex aspect-[4/3] items-center justify-center bg-surface-soft">{song.albumArt ? <img src={song.albumArt} alt="" className="size-full object-cover" loading="lazy" /> : <Music2 className="size-10 text-muted" />}</div>
          <div className="space-y-2 p-4"><h2 className="line-clamp-1 font-bold text-ink">{song.title}</h2><p className="line-clamp-1 text-[14px] text-body">{song.artist.name}</p><SongRatingBadges difficulty={song.difficulty} proficiency={song.proficiency ?? null} /></div>
        </button><div className="flex items-center justify-between border-t border-line-subtle px-4 py-2"><span className="text-[13px] text-muted">{song.categories.map(category => category.name).join(', ')}</span><button type="button" aria-label={favorites.has(song.id)?'즐겨찾기 해제':'즐겨찾기'} onClick={() => {void toggleFavorite(song);}}><Heart className="size-5" fill={favorites.has(song.id)?'currentColor':'none'} /></button></div>
      </article>)}</div>}
    {total > LIMIT ? <div className="flex justify-center gap-3"><Button variant="outline" disabled={page<=1} onClick={() => {setPage(value => value-1);setLoading(true);}}>이전</Button><span className="self-center">{page} / {Math.ceil(total/LIMIT)}</span><Button variant="outline" disabled={page*LIMIT>=total} onClick={() => {setPage(value => value+1);setLoading(true);}}>다음</Button></div> : null}
    {selected ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={event => {if(event.target===event.currentTarget) setSelected(null);}}><div role="dialog" aria-modal="true" aria-label={selected.title} className="max-h-[90svh] w-full max-w-lg overflow-y-auto rounded-md bg-canvas p-6 shadow-xl"><h2 className="text-[24px] font-bold">{selected.title}</h2><p className="mt-1 text-body">{selected.artist.name}</p><div className="mt-4"><SongRatingBadges difficulty={selected.difficulty} proficiency={selected.proficiency ?? null} /></div><p className="mt-4 whitespace-pre-wrap">{selected.description}</p>
      <div className="mt-5 flex flex-wrap gap-2">{selected.karaokeUrl ? <a href={selected.karaokeUrl} target="_blank" rel="noopener noreferrer" className="text-action underline">반주 영상</a> : null}{selected.coverUrl ? <a href={selected.coverUrl} target="_blank" rel="noopener noreferrer" className="text-action underline">커버 영상</a> : null}{selected.originalUrl ? <a href={selected.originalUrl} target="_blank" rel="noopener noreferrer" className="text-action underline">원곡 영상</a> : null}</div>
      <div className="mt-6 flex justify-end gap-2">{canManage ? <Button variant="outline" onClick={() => {setEditing(selected);setSelected(null);}}>수정</Button> : null}<Button onClick={() => setSelected(null)}>닫기</Button></div></div></div> : null}
    {editing ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={event => {if(event.target===event.currentTarget) setEditing(null);}}><form role="dialog" aria-modal="true" aria-label="노래 편집" onSubmit={event => {void save(event);}} className="max-h-[90svh] w-full max-w-lg space-y-4 overflow-y-auto rounded-md bg-canvas p-6 shadow-xl"><h2 className="text-[22px] font-bold">{editing==='new'?'노래 추가':'노래 수정'}</h2>
      <label className="block space-y-1">제목<Input name="title" required maxLength={255} defaultValue={editing==='new'?'':editing.title} /></label><label className="block space-y-1">가수<Input name="artistName" required maxLength={255} defaultValue={editing==='new'?'':editing.artist.name} /></label>
      <label className="block space-y-1">앨범 이미지 URL<Input name="albumArt" type="url" defaultValue={editing==='new'?'':editing.albumArt} /></label><label className="block space-y-1">반주 영상 URL<Input name="karaokeUrl" type="url" defaultValue={editing==='new'?'':editing.karaokeUrl} /></label>
      <label className="block space-y-1">난이도<select name="difficulty" defaultValue={editing==='new'?1:editing.difficulty} className="h-12 w-full rounded-sm border border-line bg-canvas px-3">{[1,2,3,4,5].map(value => <option key={value} value={value}>{value}성</option>)}</select></label>
      <fieldset className="space-y-1"><legend>분류</legend><div className="flex flex-wrap gap-3">{options.categories.map(category => <label key={category.id} className="flex items-center gap-1"><input type="checkbox" name="categoryIds" value={category.id} defaultChecked={editing!=='new'&&editing.categories.some(c => c.id===category.id)} />{category.name}</label>)}</div></fieldset>
      <label className="block space-y-1">설명<Textarea name="description" defaultValue={editing==='new'?'':editing.description??''} /></label>{notice?<p role="alert" className="text-danger">{notice}</p>:null}<div className="flex flex-wrap justify-end gap-2">{editing!=='new'?<Button type="button" variant="destructive" disabled={busy} onClick={() => {void remove();}}>삭제</Button>:null}<Button type="button" variant="outline" onClick={() => setEditing(null)}>닫기</Button><Button type="submit" disabled={busy}>저장</Button></div>
    </form></div> : null}
    {categoryOpen ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><form role="dialog" aria-modal="true" aria-label="분류 추가" onSubmit={event => {void createCategory(event);}} className="w-full max-w-sm space-y-4 rounded-md bg-canvas p-6"><h2 className="text-[22px] font-bold">분류 추가</h2><Input name="name" required maxLength={80} placeholder="분류 이름" />{notice?<p role="alert" className="text-danger">{notice}</p>:null}<div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setCategoryOpen(false)}>닫기</Button><Button type="submit" disabled={busy}>저장</Button></div></form></div> : null}
  </section>;
}
