'use client';

import { useState, useCallback, useEffect } from 'react';

const STORAGE_PREFIX = 'meloming_onboarding_';

/**
 * 특정 힌트의 dismiss 상태를 관리하는 훅
 */
export function useDismissible(key: string) {
  const storageKey = `${STORAGE_PREFIX}${key}`;
  const [dismissed, setDismissed] = useState(true); // SSR 안전: 기본값 true(숨김)

  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    setDismissed(stored === '1');
  }, [storageKey]);

  const dismiss = useCallback(() => {
    localStorage.setItem(storageKey, '1');
    setDismissed(true);
  }, [storageKey]);

  const reset = useCallback(() => {
    localStorage.removeItem(storageKey);
    setDismissed(false);
  }, [storageKey]);

  return { dismissed, dismiss, reset };
}

export interface SetupStatus {
  /** 오버레이 토큰이 존재하는지 */
  hasToken: boolean;
  /** 위젯 설정이 하나라도 있는지 */
  hasCustomTheme: boolean;
  /** 신청곡 설정이 활성 세션에서 설정되었는지 */
  hasActiveSession: boolean;
  /** 전체 완료 여부 */
  allComplete: boolean;
  /** 로딩 중인지 */
  isLoading: boolean;
}

/**
 * 온보딩 셋업 상태를 계산하는 훅
 * 외부에서 데이터를 주입받아 판단
 */
export function useSetupStatus({
  tokenData,
  hasActiveSession,
  isLoading,
  widgetConfigsData,
}: {
  tokenData: { overlayToken?: string | null } | undefined;
  hasActiveSession: boolean;
  isLoading: boolean;
  widgetConfigsData?: { widgets?: unknown[] } | undefined;
}): SetupStatus {
  const hasToken = Boolean(tokenData?.overlayToken);

  const hasCustomTheme = Boolean(
    widgetConfigsData?.widgets && widgetConfigsData.widgets.length > 0,
  );

  const allComplete = hasToken && hasCustomTheme && hasActiveSession;

  return {
    hasToken,
    hasCustomTheme,
    hasActiveSession,
    allComplete,
    isLoading,
  };
}
