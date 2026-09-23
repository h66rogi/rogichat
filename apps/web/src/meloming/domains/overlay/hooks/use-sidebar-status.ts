'use client';

import { useOverlayToken } from '@/meloming/domains/channel/hooks/use-overlay-token';
import { useUnifiedThemeConfig } from '@/meloming/domains/channel/hooks/use-overlay-theme';
import { useActiveSession } from '@/meloming/domains/overlay/hooks/use-session';
import { VALID_WIDGET_TYPES } from '@/meloming/domains/channel/apis/overlay-theme';

export interface SidebarSetupStatus {
  /** 오버레이 토큰이 존재 (기본적으로 채널 생성 시 존재) */
  hasToken: boolean;
  /** 활성 세션이 존재 (신청곡 설정이 의미 있는 상태) */
  hasActiveSession: boolean;
  /** 위젯 설정 여부 (통합 테마에서 default 또는 위젯 override가 존재하는지) */
  hasWidgetConfig: boolean;
  /** 데이터 로딩 중 */
  isLoading: boolean;
}

/**
 * 사이드바에서 설정 완료 상태를 표시하기 위한 경량 훅.
 *
 * Phase 3 이후로는 `/overlay-widgets/configs` 엔드포인트가 제거되었으므로
 * `useUnifiedThemeConfig`로 채널 통합 테마를 가져와서 아래 조건 중 하나라도
 * 만족하면 `hasWidgetConfig=true`로 간주한다:
 * - `default.themeId`가 기본 테마(`brutalist`) 이외의 값
 * - 4개 위젯 중 하나라도 override (themeId 또는 options가 null이 아님) 설정
 */
export function useSidebarSetupStatus(identifier: string | undefined): SidebarSetupStatus {
  const { data: tokenData, isLoading: tokenLoading } = useOverlayToken(
    identifier ?? '',
    Boolean(identifier),
  );
  const { data: themeConfig, isLoading: themeLoading } = useUnifiedThemeConfig(
    identifier ?? '',
    Boolean(identifier),
  );
  const { data: activeSession, isLoading: sessionLoading } = useActiveSession(
    identifier,
  );

  const hasWidgetConfig = Boolean(
    themeConfig &&
      (themeConfig.default.themeId !== 'brutalist' ||
        VALID_WIDGET_TYPES.some((widget) => {
          const entry = themeConfig.widgets?.[widget];
          return Boolean(entry && (entry.themeId !== null || entry.options !== null));
        })),
  );

  return {
    hasToken: Boolean(tokenData?.overlayToken),
    hasActiveSession: Boolean(activeSession?.id),
    hasWidgetConfig,
    isLoading: tokenLoading || themeLoading || sessionLoading,
  };
}
