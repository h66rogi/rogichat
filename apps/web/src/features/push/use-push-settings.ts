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
  /** Re-reads browser and server state after an error. Never prompts. */
  refresh: () => void;
}

const LOADING: PushNotificationsModel = {
  support: 'unknown',
  permission: 'unknown',
  enabled: null,
  toggle: { enabled: false, reason: '알림 설정을 확인하는 중입니다.' },
};

export function usePushSettings(session: Session, accountId: string): PushSettings {
  const api = useApi();
  const [enrollment, setEnrollment] = useState<PushEnrollment | null>(null);
  const [, changed] = useReducer((count: number) => count + 1, 0);
  const scope = useRef<PushScope | null>(null);
  const csrf = useRef(session.csrfToken);
  // Kept current so every request carries the session's latest token rather than the one this
  // screen opened with. Written in an effect, never during render.
  useEffect(() => { csrf.current = session.csrfToken; }, [session.csrfToken]);

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
        storage: guardedStorage(localStorage),
        scope: identity,
      });
      setEnrollment(controller);
      await controller.refresh();
    };
    void start();
    return () => {
      current = false;
      // The account or session changed, or the screen closed: end the scope so requests abort
      // and no late completion is applied under a different account.
      scope.current?.end();
      scope.current = null;
    };
  }, [api.origin, accountId, session.csrfToken]);

  useEffect(() => enrollment?.subscribe(changed), [enrollment]);

  const toggle = useCallback(() => {
    // Dispatched without awaiting first, so the permission prompt stays inside the click's
    // transient activation.
    void enrollment?.toggle();
  }, [enrollment]);

  const refresh = useCallback(() => {
    void enrollment?.refresh();
  }, [enrollment]);

  const state = enrollment?.getState();
  const model = enrollment?.model();
  return {
    // `action`, `busy` and `notice` let the section name the real press and show the real
    // result, instead of inferring either from the displayed value.
    model: model === undefined ? LOADING : { ...model, action: enrollment?.intent() ?? null, busy: state?.busy ?? false, notice: state?.notice ?? '' },
    toggle,
    notice: state?.notice ?? '',
    needsDecision: state?.needsDecision ?? false,
    refresh,
  };
}
