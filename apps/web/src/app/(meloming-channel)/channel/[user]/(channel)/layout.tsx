import type { ReactNode } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import {
  getChannelIdentifierServer,
  getChannelIdentifierPermissionServer,
  getChannelFeatureSettingsServer,
} from "@/meloming/domains/channel/apis/channels-server";
import { getChannelSetlistAvailabilityServer } from "@/meloming/domains/song-live/apis/setlist-server";
import { ChannelLayout } from "@/meloming/domains/channel/components/channel-layout";
import UserNotFoundError from "@/meloming/domains/channel/components/channel/user-not-found-error";
import {
  getTabFromPath,
  isChannelTabEnabled,
} from "@/meloming/domains/channel/types/channel-tab";
import { REQUEST_PATHNAME_HEADER } from "@/meloming/shared/lib/request-pathname";

interface ChannelLayoutProps {
  children: ReactNode;
  params: Promise<{ user: string }>;
}

/**
 * 채널 페이지 레이아웃
 * UserHeader와 UserMenu를 공통으로 렌더링
 * 서버에서 채널 데이터와 권한을 미리 가져와 SSR로 렌더링
 * Note: searchParams는 layout에서 사용할 수 없으므로
 * ?tab= 리다이렉트는 각 page.tsx에서 처리됩니다.
 */
export default async function ChannelLayoutWrapper({
  children,
  params,
}: ChannelLayoutProps) {
  const { user } = await params;

  // 서버에서 채널 데이터, 권한 데이터, 기능 설정, 셋리스트 가용성을 병렬로 가져옴
  const [channelData, permissionData, featureSettings, setlistAvailability] =
    await Promise.all([
      getChannelIdentifierServer(user),
      getChannelIdentifierPermissionServer(user),
      getChannelFeatureSettingsServer(user),
      getChannelSetlistAvailabilityServer(user),
    ]);

  if (!channelData) {
    notFound();
  }

  const requestHeaders = await headers();
  const pathname = requestHeaders.get(REQUEST_PATHNAME_HEADER);
  const currentTab = pathname ? getTabFromPath(pathname) : null;
  if (currentTab && !isChannelTabEnabled(featureSettings, currentTab)) {
    notFound();
  }

  // 권한 확인: view 권한이 없으면 에러 표시
  if (permissionData && !permissionData.view) {
    return <UserNotFoundError />;
  }

  return (
    <ChannelLayout
      user={user}
      channelData={channelData}
      permissionData={permissionData}
      guestbookEnabled={isChannelTabEnabled(featureSettings, "guestbook")}
      setlistEnabled={setlistAvailability.available}
      featureSettings={featureSettings}
    >
      {children}
    </ChannelLayout>
  );
}
