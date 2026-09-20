'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiError, type Session } from '@/core/api/client';
import { parseAccountCapabilities, type AccountCapabilities } from '@/core/api/access-contract';
import { useApi } from '@/core/runtime/provider';
import { invalidateSession } from './private-session';

export function AccountAccess({ session }: { session: Session }) {
  const api = useApi();
  const [capabilities, setCapabilities] = useState<AccountCapabilities | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const result = parseAccountCapabilities(await api.request('/v1/me/capabilities', { signal: controller.signal }));
        const current = await api.session(controller.signal);
        if (current.csrfToken !== session.csrfToken || current.accountPartition !== session.accountPartition) { invalidateSession(); return; }
        if (!controller.signal.aborted) { setCapabilities(result); setError(false); }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && [401, 403].includes(error.status)) invalidateSession();
        else setError(true);
      }
    })();
    return () => controller.abort();
  }, [api, session, attempt]);
  if (error) return <p role="status">계정 권한을 확인하지 못했습니다. <button className="min-h-11 underline" onClick={() => setAttempt(value => value + 1)}>다시 확인</button></p>;
  return capabilities?.admin.enabled ? <Link href="/admin" className="inline-flex min-h-11 items-center underline">관리자 페이지</Link> : null;
}
