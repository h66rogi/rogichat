'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '@/core/runtime/provider';
import { PrivateGate } from '@/features/auth/auth-panel';
import { usePrivateSession } from '@/features/auth/private-session';

interface Item { id: string; type: 'MESSAGE'; title: string; body: string; url: '/chat'; roomId: string; messageId: string; readAt: string | null; createdAt: string }
interface Page { items: Item[]; nextCursor: string | null; hasNextPage: boolean }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function page(value: unknown): Page {
  if (!value || typeof value !== 'object') throw new Error('invalid_notification_page');
  const result = value as Page;
  if (!Array.isArray(result.items) || result.items.length > 20 ||
      !(result.nextCursor === null || typeof result.nextCursor === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(result.nextCursor)) ||
      typeof result.hasNextPage !== 'boolean' ||
      result.items.some(item => !item || !UUID.test(item.id) || !UUID.test(item.roomId) || !UUID.test(item.messageId) || item.id !== item.messageId || item.type !== 'MESSAGE' || item.url !== '/chat' ||
        typeof item.title !== 'string' || item.title.length > 80 || typeof item.body !== 'string' || item.body.length > 120 ||
        (item.readAt !== null && (typeof item.readAt !== 'string' || !Number.isFinite(Date.parse(item.readAt)))) ||
        !Number.isFinite(Date.parse(item.createdAt)))) throw new Error('invalid_notification_page');
  return result;
}

export function RealNotificationInbox() {
  const { state, refresh: refreshSession } = usePrivateSession();
  if (state.kind !== 'ready') return <PrivateGate state={state} retry={refreshSession} />;
  return <Inbox key={state.generation} csrf={state.session.csrfToken} />;
}

function Inbox({ csrf }: { csrf: string }) {
  const api = useApi();
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const load = useCallback(async (next: string | null) => {
    if (next) setMore(true); else setLoading(true);
    setError(null);
    const controller = new AbortController(); request.current = controller;
    try {
      const query = new URLSearchParams({ limit: '20', ...(next ? { cursor: next } : {}) });
      const response = page(await api.request(`/v1/me/notifications?${query}`, { signal: controller.signal }));
      if (!mounted.current || controller.signal.aborted) return;
      setItems(previous => next ? [...previous, ...response.items.filter(item => !previous.some(old => old.id === item.id))] : response.items);
      setCursor(response.nextCursor);
    } catch {
      if (mounted.current && !controller.signal.aborted) setError(next ? '알림을 더 불러오지 못했어요.' : '알림을 불러오지 못했어요. 다시 시도해 주세요.');
    } finally {
      if (mounted.current) { setLoading(false); setMore(false); }
    }
  }, [api]);
  useEffect(() => {
    mounted.current = true; queueMicrotask(() => { if (mounted.current) void load(null); });
    return () => { mounted.current = false; request.current?.abort(); };
  }, [load]);
  const mark = async (item: Item): Promise<boolean> => {
    try {
      await api.request(`/v1/me/notifications/${item.id}/read`, { method: 'POST', csrf, body: {} });
      if (mounted.current) setItems(previous => previous.map(value => value.id === item.id ? { ...value, readAt: new Date().toISOString() } : value));
      return true;
    } catch { if (mounted.current) setError('읽음 상태를 저장하지 못했어요.'); return false; }
  };
  const markAll = async () => {
    if (marking) return;
    setMarking(true);
    for (const item of items.filter(value => value.readAt === null)) if (!await mark(item)) break;
    if (mounted.current) setMarking(false);
  };
  return <main className="mx-auto max-w-[42rem] px-4 py-6" data-testid="notification-inbox">
    <header className="mb-5 flex items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold text-ink">알림</h1>
      <div className="flex gap-3 text-sm">
        <Link href="/settings#notifications" className="underline">알림 설정</Link>
        {items.some(item => item.readAt === null) && <button type="button" onClick={() => void markAll()} disabled={marking} className="underline disabled:opacity-50">모두 읽기</button>}
      </div>
    </header>
    {loading && items.length === 0 ? <p role="status">알림을 확인하고 있어요.</p> :
      error && items.length === 0 ? <div role="alert"><p>{error}</p><button type="button" onClick={() => void load(null)} className="mt-3 underline">다시 시도</button></div> :
      items.length === 0 ? <p className="py-16 text-center text-muted">새로운 알림이 도착하면 여기에 표시됩니다.</p> :
      <ul className="divide-y divide-line rounded-xl border border-line">
        {items.map(item => <li key={item.id}>
          <button type="button" className={`flex min-h-20 w-full items-start gap-3 p-4 text-left ${item.readAt === null ? 'bg-accent/5' : ''}`}
            onClick={() => { void (async () => { if (!item.readAt) await mark(item); router.push(`/chat?roomId=${encodeURIComponent(item.roomId)}&messageId=${encodeURIComponent(item.messageId)}`); })(); }}>
            <span aria-hidden="true" className="mt-1 rounded-full bg-accent/10 p-2">🔔</span>
            <span className="min-w-0 flex-1"><span className="block truncate font-medium text-ink">{item.title}</span>
              <span className="block text-sm text-muted">{item.body}</span>
              <time className="mt-1 block text-xs text-muted" dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('ko-KR')}</time></span>
            {item.readAt === null && <span aria-label="읽지 않음" className="mt-2 h-2 w-2 rounded-full bg-accent" />}
          </button>
        </li>)}
      </ul>}
    {error && items.length > 0 && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
    {cursor && <button type="button" onClick={() => void load(cursor)} disabled={more} className="mt-5 min-h-11 w-full rounded-lg border border-line text-sm disabled:opacity-50">{more ? '불러오는 중' : '더 보기'}</button>}
  </main>;
}
