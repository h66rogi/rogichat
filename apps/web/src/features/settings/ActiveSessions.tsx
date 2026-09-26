'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, type Session } from '@/core/api/client';
import { useApi } from '@/core/runtime/provider';
import { invalidateSession } from '@/features/auth/private-session';

type Device = { id: string; kind: 'web' | 'ios' | 'android' | 'other'; createdAt: string; expiresAt: string; current: boolean };
type Page = { sessions: Device[]; next: string | null };
const names: Record<Device['kind'], string> = { web: '웹 브라우저', ios: 'iPhone 또는 iPad', android: 'Android 기기', other: '다른 기기' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function validPage(value: Page): Page {
  if (!value || !Array.isArray(value.sessions) || (value.next !== null && (typeof value.next !== 'string' || !uuid.test(value.next))) ||
    value.sessions.some(item => !uuid.test(item.id) || !Object.hasOwn(names, item.kind) || typeof item.current !== 'boolean' || !Number.isFinite(Date.parse(item.createdAt)) || !Number.isFinite(Date.parse(item.expiresAt)))) throw new Error('invalid_sessions');
  return value;
}

export function ActiveSessions({ session }: { session: Session }) {
  const api = useApi();
  const [items, setItems] = useState<Device[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const working = useRef(false);
  const alive = useRef(true);
  const load = useCallback(async (after?: string) => {
    if (working.current) return;
    working.current = true; setBusy(true); setError('');
    try {
      const page = validPage(await api.request<Page>(`/v1/auth/sessions${after ? `?after=${encodeURIComponent(after)}` : ''}`));
      if (alive.current) { setItems(old => after ? [...old, ...page.sessions.filter(item => !old.some(previous => previous.id === item.id))] : page.sessions); setNext(page.next); }
    } catch (cause) {
      if (alive.current) {
        if (cause instanceof ApiError && cause.status === 401) invalidateSession();
        else setError('로그인된 기기를 확인하지 못했어요. 다시 시도해 주세요.');
      }
    } finally { working.current = false; if (alive.current) setBusy(false); }
  }, [api]);
  useEffect(() => {
    alive.current = true;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => { window.clearTimeout(timer); alive.current = false; };
  }, [load, session.csrfToken]);
  async function revoke(id: string) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await api.request(`/v1/auth/sessions/${id}`, { method: 'DELETE', csrf: session.csrfToken });
      if (alive.current) { setItems(old => old.filter(item => item.id !== id)); setConfirm(null); setNotice('기기에서 로그아웃했어요.'); }
    } catch (cause) {
      if (alive.current) {
        if (cause instanceof ApiError && cause.status === 401) invalidateSession();
        else { setError('로그아웃 결과를 확인하지 못했어요. 목록을 다시 확인해 주세요.'); setConfirm(null); }
      }
    } finally { working.current = false; if (alive.current) setBusy(false); }
  }
  return <section aria-labelledby="active-sessions-title" className="rounded-2xl border border-control-border p-4 sm:p-6">
    <h2 id="active-sessions-title" className="text-lg font-semibold">로그인된 기기</h2>
    <p className="mt-1 text-sm text-body">사용하지 않는 기기는 여기에서 로그아웃할 수 있어요.</p>
    <p role="status" className="mt-2 text-sm">{notice || (busy ? '확인하는 중' : '')}</p>
    {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    {(error || (!busy && items.length === 0)) && <button type="button" className="min-h-11 underline" onClick={() => void load()} disabled={busy}>다시 확인</button>}
    <ul className="mt-3 space-y-3">{items.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-soft p-3">
      <div><p className="font-medium">{names[item.kind]} {item.current && <span className="text-sm text-body">· 현재 기기</span>}</p><p className="text-sm text-body">로그인: {new Date(item.createdAt).toLocaleString('ko-KR')}</p></div>
      {!item.current && (confirm === item.id ? <div className="flex flex-wrap gap-2"><button type="button" className="min-h-11 rounded-lg border border-control-border px-3" onClick={() => setConfirm(null)}>취소</button><button type="button" className="min-h-11 rounded-lg bg-danger px-3 text-white" onClick={() => void revoke(item.id)} disabled={busy} aria-label={`${names[item.kind]} 로그아웃 확인`}>로그아웃 확인</button></div> : <button type="button" className="min-h-11 rounded-lg border border-control-border px-3" onClick={() => setConfirm(item.id)} disabled={busy} aria-label={`${names[item.kind]} 로그아웃`}>로그아웃</button>)}
    </li>)}</ul>
    {next && <button type="button" className="mt-3 min-h-11 underline" onClick={() => void load(next)} disabled={busy}>기기 더 보기</button>}
  </section>;
}
