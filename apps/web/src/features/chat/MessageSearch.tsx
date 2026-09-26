'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { useApi } from '@/core/runtime/provider';
import { PrivateGate } from '@/features/auth/auth-panel';
import { usePrivateSession } from '@/features/auth/private-session';
import { Button } from '@/shared/ui/button';

interface Hit { messageId: string; roomId: string; roomName: string; createdAt: string; author: string; excerpt: string }
interface Result { items: Hit[]; nextCursor: string | null }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function result(value: unknown): Result {
  if (!value || typeof value !== 'object') throw new Error('invalid_search_result');
  const page = value as Result;
  if (!Array.isArray(page.items) || page.items.length > 30 ||
    !(page.nextCursor === null || typeof page.nextCursor === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(page.nextCursor)) ||
    page.items.some(hit => !hit || !UUID.test(hit.messageId) || !UUID.test(hit.roomId) ||
      typeof hit.roomName !== 'string' || typeof hit.author !== 'string' || typeof hit.excerpt !== 'string' ||
      !Number.isFinite(Date.parse(hit.createdAt)))) throw new Error('invalid_search_result');
  return page;
}

export function MessageSearch() {
  const { state, refresh } = usePrivateSession();
  if (state.kind !== 'ready') return <PrivateGate state={state} retry={refresh} />;
  return <Search key={state.generation} />;
}

function Search() {
  const api = useApi();
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [items, setItems] = useState<Hit[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const sequence = useRef(0);
  const run = async (term: string, next: string | null) => {
    const ticket = ++sequence.current;
    setLoading(true); setError(false);
    if (!next) { setSubmitted(term); setItems([]); setCursor(null); }
    try {
      const search = new URLSearchParams({ q: term, ...(next ? { cursor: next } : {}) });
      const response = result(await api.request(`/v1/me/messages/search?${search}`));
      if (ticket !== sequence.current) return;
      setItems(previous => next ? [...previous, ...response.items.filter(hit => !previous.some(item => item.messageId === hit.messageId))] : response.items);
      setCursor(response.nextCursor);
    } catch { if (ticket === sequence.current) setError(true); }
    finally { if (ticket === sequence.current) setLoading(false); }
  };
  return <main className="mx-auto w-full max-w-3xl px-4 py-6" aria-label="메시지 검색">
    <h1 className="text-2xl font-semibold text-ink">대화 내용 검색</h1>
    <p className="mt-2 text-sm text-muted">내가 볼 수 있는 모든 대화의 메시지를 찾습니다.</p>
    <form className="mt-5 flex gap-2" onSubmit={event => { event.preventDefault(); const term = query.trim(); if (term.length >= 2 && term.length <= 100) void run(term, null); }}>
      <input value={query} onChange={event => setQuery(event.target.value)} maxLength={100} minLength={2} aria-label="찾을 문장" placeholder="메시지 문장 검색" className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-3 py-2 text-ink" />
      <Button type="submit" disabled={loading || query.trim().length < 2}>검색</Button>
    </form>
    {loading && !cursor && <p className="mt-6" role="status">대화 내용을 찾고 있어요.</p>}
    {error && <div className="mt-6" role="alert"><p>검색하지 못했어요. 연결 상태를 확인해 주세요.</p><Button variant="outline" className="mt-2" onClick={() => void run(submitted, cursor)}>다시 시도</Button></div>}
    {!loading && !error && submitted && items.length === 0 && <p className="mt-8 text-muted">찾은 메시지가 없어요.</p>}
    {items.length > 0 && <ul className="mt-6 divide-y divide-line rounded-xl border border-line">
      {items.map(hit => <li key={hit.messageId}><Link href={`/chat?roomId=${encodeURIComponent(hit.roomId)}&messageId=${encodeURIComponent(hit.messageId)}`} className="block p-4 hover:bg-surface-soft focus-visible:outline-2">
        <span className="text-sm font-medium text-ink">{hit.roomName} · {hit.author}</span>
        <time className="ml-2 text-xs text-muted" dateTime={hit.createdAt}>{new Date(hit.createdAt).toLocaleString('ko-KR')}</time>
        <span className="mt-2 block whitespace-pre-wrap break-words text-sm text-body">{hit.excerpt}</span>
      </Link></li>)}
    </ul>}
    {cursor && <Button variant="outline" className="mt-4 w-full" disabled={loading} onClick={() => void run(submitted, cursor)}>{loading ? '더 찾는 중' : '더 보기'}</Button>}
  </main>;
}
