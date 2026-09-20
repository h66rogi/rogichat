'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import type { Session } from '@/core/api/client';
import { sessionBinding } from '@/core/api/session-binding';
import { useApi } from '@/core/runtime/provider';

import { PushApi } from './api';
import { guardedStorage } from './binding';
import { WebPushBrowser } from './browser';
import { PushEnrollment } from './enrollment';
import type { PushNotificationsModel } from './enrollment';
import { pushHttp } from './http';
import { adoptScope } from './scope';
import type { PushScope } from './scope';

/**
 * Mounts the enrollment lifecycle for the signed-in account into the settings screen.
 *
 * The account and session identities are one-way digests, matching how the rest of the app
 * binds local state to a session: no raw account id, CSRF token or credential enters browser
 * storage. The CSRF token is read per request from the latest render, so a rotated token is
 * used rather than one captured when the screen opened.
 */
export interface PushSettings {
  /** Assign directly into `SettingsViewModel.notifications`. */
  model: PushNotificationsModel;
  /**
   * Pass as `onToggleNotifications`. It deliberately ignores the boolean the control offers:
   * the press means enrol or release depending on real state, and deriving that from the
   * displayed value would send a cleanup press to enrolment, which refuses.
   */
  toggle: () => void;
  /** Honest result of the last action; empty when there is nothing to say. */
  notice: string;
  /** A compare-and-set conflict needs a fresh choice against the value now stored. */
  needsDecision: boolean;
  /** Pass as `onRetryNotifications`. Re-reads state, or rebuilds after a failed start. */
  refresh: () => void;
}

const CHECKING = '알림 설정을 확인하는 중입니다.';
const UNAVAILABLE = '이 브라우저에서 알림 설정을 준비하지 못했습니다. 다시 확인해 주세요.';

const blocked = (reason: string, notice = ''): PushNotificationsModel => ({
  support: 'unknown',
  permission: 'unknown',
  enabled: null,
  toggle: { enabled: false, reason },
  action: null,
  busy: false,
  notice,
});

export function usePushSettings(session: Session, accountId: string): PushSettings {
  const api = useApi();
  const [attempt, retry] = useReducer((count: number) => count + 1, 0);
  const [, changed] = useReducer((count: number) => count + 1, 0);
  /** A lifecycle belongs to one origin, account, session and attempt; null means it failed to start. */
  const [built, setBuilt] = useState<{ key: string; enrollment: PushEnrollment | null } | null>(null);
  const scope = useRef<PushScope | null>(null);
  const csrf = useRef(session.csrfToken);

  // Kept current so every request carries the session's latest token rather than the one this
  // screen opened with. Written in an effect, never during render.
  useEffect(() => { csrf.current = session.csrfToken; }, [session.csrfToken]);

  const key = `${api.origin}|${accountId}|${session.csrfToken}|${attempt}`;
  // Derived, not stored: the moment the account or session changes, the previous lifecycle
  // stops being read, so one account's enrollment is never shown while another is preparing.
  const active = built?.key === key ? built : null;
  const enrollment = active?.enrollment ?? null;
  const failed = active !== null && active.enrollment === null;

  useEffect(() => {
    let current = true;

    const start = async (): Promise<void> => {
      const [account, sessionId] = await Promise.all([sessionBinding(accountId), sessionBinding(csrf.current)]);
      if (!current) return;
      const identity = adoptScope(scope.current, { account, session: sessionId });
      scope.current = identity;
      const controller = new PushEnrollment({
        api: new PushApi(pushHttp({ apiOrigin: api.origin, csrf: () => csrf.current })),
        browser: new WebPushBrowser(),
        // Acquired inside the guard: reading `localStorage` itself throws where site data is blocked.
        storage: guardedStorage(() => localStorage),
        scope: identity,
      });
      setBuilt({ key, enrollment: controller });
      await controller.refresh();
    };

    // A failed start — blocked storage, an unavailable digest — is a stated result with a
    // retry, never an indefinite "checking" or an unhandled rejection.
    start().catch(() => { if (current) setBuilt({ key, enrollment: null }); });

    return () => {
      current = false;
      // The account or session changed, or the screen closed: end the scope so requests abort
      // and no late completion is applied under a different account.
      scope.current?.end();
      scope.current = null;
    };
  }, [key, api.origin, accountId]);

  useEffect(() => enrollment?.subscribe(changed), [enrollment]);

  const toggle = useCallback(() => {
    // Dispatched without awaiting first, so the permission prompt stays inside the click's
    // transient activation.
    void enrollment?.toggle();
  }, [enrollment]);

  const refresh = useCallback(() => {
    if (enrollment === null) {
      retry();
      return;
    }
    void enrollment.refresh();
  }, [enrollment]);

  const state = enrollment?.getState();
  const model = enrollment?.model();
  return {
    // `action`, `busy` and `notice` let the section name the real press and show the real
    // result, instead of inferring either from the displayed value.
    model: model === undefined || enrollment === null
      ? (failed ? blocked(UNAVAILABLE, UNAVAILABLE) : blocked(CHECKING))
      : { ...model, action: enrollment.intent(), busy: state?.busy ?? false, notice: state?.notice ?? '' },
    toggle,
    notice: failed ? UNAVAILABLE : state?.notice ?? '',
    needsDecision: state?.needsDecision ?? false,
    refresh,
  };
}
