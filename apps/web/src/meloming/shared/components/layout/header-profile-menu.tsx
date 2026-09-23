"use client";

import { useAuth } from "@/meloming/domains/auth/hooks/use-auth";
import { useHydrated } from "@/meloming/shared/hooks/use-hydrated";
import { routes } from "@/meloming/shared/lib/service-routes";
import { RemoteProfilePopover } from "@/meloming/shared/components/layout/header/global-chrome-popovers";

/**
 * 헤더 상단바용 공용 프로필 MFE(아바타만). 클라이언트 세션(useAuth)으로 구동하며
 * remote 장애 시 기존 로컬 UserProfileMenu로 폴백한다.
 *
 * 사용처: 메인 홈 상단바(HomeV3SearchBar), GlobalThinHeader(관리/채널 셸).
 * 트리거 크기/톤은 배치되는 헤더 스코프의 CSS(.profile-trigger--compact)가 맞춘다.
 */
export function HeaderProfileMenu() {
  const hydrated = useHydrated();
  const { user, logout } = useAuth(hydrated);
  // user === undefined: 세션 미확정(하이드레이션/조회 전) → 스켈레톤.
  // user === null: 게스트 확정 → 로그인 링크 아바타. user 객체: 로그인 → 팝오버.
  const loading = !hydrated || user === undefined;
  return (
    <RemoteProfilePopover
      user={user ?? null}
      loading={loading}
      loginHref={routes.account.login(
        typeof window !== "undefined" ? window.location.href : "/",
      )}
      accountHref={routes.id.security()}
      accountLabel="통합 ID · 계정 및 보안"
      extraItems={[
        {
          href: routes.account.home(),
          label: "멜로밍 마이페이지",
          icon: "external",
        },
      ]}
      onLogout={() => {
        void logout();
      }}
      compact
    />
  );
}
