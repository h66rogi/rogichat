'use client';

import { useEffect, useState } from 'react';

import { type SessionGateAdapter, type SessionGateState, unavailableSessionGateAdapter } from '@/core/session/session-gate';

/**
 * Runs the session gate check in the browser. The adapter is injectable so preview/test harnesses can
 * supply a synthetic state; the production default is the FW01 `unavailable` adapter.
 */
export function useSessionGate(adapter: SessionGateAdapter = unavailableSessionGateAdapter): SessionGateState {
  const [state, setState] = useState<SessionGateState>({ kind: 'checking' });

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    adapter
      .check(controller.signal)
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'networkError' });
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [adapter]);

  return state;
}
