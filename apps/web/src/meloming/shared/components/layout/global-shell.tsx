'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useInAppMode } from '@/meloming/shared/hooks/use-inapp-mode';
import { ManageShell } from '@/meloming/features/home-new/layout/ManageShell';
import { ChannelShell } from '@/meloming/features/home-new/layout/ChannelShell';
import {
  MANAGEMENT_MENU_ITEMS,
  type ManagementSection,
} from '@/meloming/domains/channel/components/management/types';
import type { ChannelShellInitialData } from '@/meloming/features/home-new/layout/channel-shell-initial-data';
import { resolvePublicChannelRoute } from '@/meloming/shared/lib/public-channel-route';

type Props = {
  initialChannelShellData?: ChannelShellInitialData;
  children: ReactNode;
};

const MANAGE_PATH_RE = /^\/channel\/([^/]+)\/manage(?:\/(.+))?$/;

function resolveManageSection(afterManage: string | undefined): ManagementSection {
  if (!afterManage) return 'home';
  const firstSegment = afterManage.split('/').filter(Boolean)[0];
  if (firstSegment === 'add-song') return 'add-song';
  const found = MANAGEMENT_MENU_ITEMS.find((item) => item.id === firstSegment);
  return found ? found.id : 'home';
}

/**
 * 공개 채널 페이지 레이아웃 게이트.
 * 모든 공개 채널 페이지를 신규 ChannelShell 레이아웃으로 렌더링한다.
 * 기존에는 channel.layoutType === 'legacy' 일 때 NewShell 로 분기했다.
 */
function ChannelShellGate({
  user,
  initialChannelShellData,
  children,
}: Props & { user: string }) {
  const matchedInitialData =
    initialChannelShellData?.user === user ? initialChannelShellData : undefined;
  // 기존 분기: if ((channel.layoutType ?? 'new') === 'legacy') return <NewShell ... />;
  // 2026년 7월 업데이트부터 공개 채널은 신규 레이아웃으로 강제한다.

  return (
    <ChannelShell
      user={user}
      initialData={matchedInitialData}
      footer={null}
    >
      {children}
    </ChannelShell>
  );
}

export function GlobalShell({
  initialChannelShellData,
  children,
}: Props) {
  const pathname = usePathname() ?? '';
  const isInApp = useInAppMode();
  const manageMatch = pathname.match(MANAGE_PATH_RE);
  const isManage = Boolean(manageMatch);

  // In-app 웹뷰: 크롬 전부 제거
  if (isInApp) {
    return (
      <div
        data-site-sticky-context="no-header"
        className="min-h-svh w-full"
      >
        <main className="flex-1">{children}</main>
      </div>
    );
  }

  // /channel/[user]/manage/*: 듀얼 레일 (전역 컴팩트 + 채널 관리 사이드바).
  if (isManage && manageMatch) {
    const user = manageMatch[1];
    const activeSection = resolveManageSection(manageMatch[2]);
    return (
      <ManageShell
        user={user}
        activeSection={activeSection}
        footer={null}
      >
        {children}
      </ManageShell>
    );
  }

  // 공개 채널 페이지 (manage 는 위에서 처리됨, live 시청 페이지는 풀스크린이라 제외):
  // 기존에는 layoutType 에 따라 신규(ChannelShell) / 기존(NewShell) 레이아웃을 결정했다.
  const publicChannelRoute = resolvePublicChannelRoute(pathname);
  if (publicChannelRoute) {
    return (
      <ChannelShellGate
        user={publicChannelRoute.user}
        initialChannelShellData={initialChannelShellData}
      >
        {children}
      </ChannelShellGate>
    );
  }

  return <>{children}</>;
}
