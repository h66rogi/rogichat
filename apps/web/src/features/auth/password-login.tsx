'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '@/core/api/client';
import { parseSession } from '@/core/api/session-contract';
import { useApi } from '@/core/runtime/provider';
import { Button } from '@/shared/ui/button';
import { invalidateSession } from './private-session';

export function PasswordLogin() {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const form = useRef<HTMLFormElement | null>(null);
  useEffect(() => {
    const clear = () => { request.current?.abort(); form.current?.reset(); };
    const hide = () => { clear(); request.current = null; setBusy(false); };
    window.addEventListener('pagehide', hide);
    return () => { clear(); window.removeEventListener('pagehide', hide); };
  }, []);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (request.current) return;
    const fields = new FormData(event.currentTarget);
    if (fields.get('terms') !== 'on') return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError('');
    try {
      const issued = parseSession(await api.request('/v1/auth/password/login', { method: 'POST', body: { clientId: 'web', loginId: String(fields.get('loginId') ?? ''), password: String(fields.get('password') ?? ''), termsVersion: '2026-09-20' }, signal: controller.signal }));
      form.current?.reset();
      const confirmed = await api.session(controller.signal);
      if (issued.accountPartition !== confirmed.accountPartition || issued.csrfToken !== confirmed.csrfToken) throw new ApiError(403, 'SESSION_CHANGED');
      if (!controller.signal.aborted) invalidateSession();
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof ApiError && error.status === 401 ? '아이디 또는 비밀번호를 확인해 주세요.' : error instanceof ApiError ? error.message : '로그인 결과를 확인하지 못했습니다. 다시 확인해 주세요.');
    } finally {
      if (request.current === controller) {
        const password = form.current?.elements.namedItem('password');
        if (password instanceof HTMLInputElement) password.value = '';
        request.current = null; if (!controller.signal.aborted) setBusy(false);
      }
    }
  };
  return <details className="rounded-xl border border-line p-4"><summary className="min-h-11 cursor-pointer font-medium">아이디·비밀번호로 로그인</summary><form ref={form} onSubmit={event => void submit(event)} className="mt-4 flex flex-col gap-4">
    <p className="text-sm text-body">발급받은 로기챗 계정으로 로그인하세요.</p>
    <label className="flex flex-col gap-2">아이디<input className="min-h-11 rounded-lg border border-line px-3" name="loginId" autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={3} maxLength={64} pattern={'[A-Za-z0-9][A-Za-z0-9._\\-]{2,63}'} disabled={busy} /></label>
    <label className="flex flex-col gap-2">비밀번호<input className="min-h-11 rounded-lg border border-line px-3" name="password" type="password" autoComplete="current-password" required disabled={busy} /></label>
    <label className="flex gap-3 text-sm"><input name="terms" type="checkbox" required disabled={busy} className="size-5 shrink-0" /><span><Link href="/rules" className="underline">이용 안내</Link>를 확인했으며, 개인 메시지가 방장에 의해 전체 공개될 수 있음을 이해합니다. (2026-09-20)</span></label>
    <Button type="submit" disabled={busy}>{busy ? '로그인 확인 중' : '아이디로 로그인'}</Button>
    {error && <p role="alert">{error}</p>}
  </form></details>;
}
