"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  useChannel,
  useChannelPermission,
} from "@/meloming/domains/channel/hooks/use-channel";
import { useMyChannel } from "@/meloming/domains/channel/hooks/use-my-channel";
import { SectionErrorBoundary } from "@/meloming/shared/components/common/error-boundary";
import UserNotFoundError from "@/meloming/domains/channel/components/channel/user-not-found-error";
import { SongsManagementWrapper } from "@/meloming/domains/channel/components/management/songs-management-wrapper";
import { SongbookDownloadManagement } from "@/meloming/domains/channel/components/management/songbook-download-management";
import { AddSongSelection } from "@/meloming/domains/channel/components/management/add-song-selection";
import { ArtistsManagementV2 as ArtistsManagement } from "@/meloming/domains/channel/components/management/artists-management-v2";
import { CategoriesManagementV2 as CategoriesManagement } from "@/meloming/domains/channel/components/management/categories-management-v2";
import { HomeDashboard } from "@/meloming/domains/channel/components/management/home-dashboard";
import { SongRequestsManagement } from "@/meloming/domains/channel/components/management/song-requests-management";
import { ScheduleSettingsContent } from "@/meloming/domains/channel/components/management/schedule-settings-content";
import { WardrobeManagement } from "@/meloming/domains/channel/components/management/wardrobe-management";
import { LiveManagementContent } from "@/features/live-management-content";
import { MANAGEMENT_MENU_ITEMS, type ManagementSection } from "@/meloming/domains/channel/components/management/types";
import { SongRequestSettingsContent } from "@/meloming/domains/overlay/components/song-request-settings-content";
import { SessionHistory } from "@/meloming/domains/overlay/components/session-history";
import { useEffect, useMemo } from "react";
import { useAuth } from "@/meloming/domains/auth/hooks/use-auth";
import type { GetChannelIdentifierPermissionResponse } from "@/meloming/domains/channel/types/channel";
import { AlertCircle } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/meloming/shared/components/ui/alert";
import { SetlistsManagement } from "@/meloming/domains/song-live/components/setlists-management";

/**
 * 섹션별 필요 권한 정의
 */
const SECTION_PERMISSIONS: Partial<
  Record<
    ManagementSection,
    (permission: GetChannelIdentifierPermissionResponse) => boolean
  >
> = {
  // 홈: 아무 관리 권한이나 있으면 접근 가능
  home: (p) =>
    p.isOwner ||
    p.manageContent ||
    p.manageSettings ||
    p.manageProfile ||
    p.manageGuestbook ||
    p.manageCustomization ||
    p.manageEmoticons,
  // 노래책 관리
  songs: (p) => p.isOwner || p.manageContent,
  "songbook-download": (p) => p.isOwner || p.manageContent,
  "add-song": (p) => p.isOwner || p.manageContent,
  categories: (p) => p.isOwner || p.manageContent,
  artists: (p) => p.isOwner || p.manageContent,
  "song-requests": (p) => p.isOwner || p.manageContent,
  // 신청곡 및 오버레이 설정
  live: (p) => p.isOwner || p.manageSettings,
  "song-request-settings": (p) => p.isOwner || p.manageSettings,
  "session-history": (p) => p.isOwner || p.manageSettings,
  // 채널 설정
  // 일정 설정
  "schedule-settings": (p) => p.isOwner || p.manageContent,
  // 셋리스트 관리: 콘텐츠 권한자
  setlists: (p) => p.isOwner || p.manageContent,
  wardrobe: (p) => p.isOwner || p.manageContent,
};

/**
 * 권한 없음 안내 컴포넌트
 */
function NoPermissionAlert({ section }: { section: string }) {
  return (
    <div className="p-6">
      <Alert variant="destructive">
        <AlertCircle className="size-4" />
        <AlertTitle>접근 권한이 없습니다</AlertTitle>
        <AlertDescription>
          &apos;{section}&apos; 페이지에 접근할 권한이 없습니다. 채널 소유자에게
          해당 권한을 요청하세요.
        </AlertDescription>
      </Alert>
    </div>
  );
}

// toss-fe 가이드라인: Reducing Eye Movement - URL 경로를 섹션으로 변환하는 로직을 inline으로 처리
export function ChannelManageContent({ user }: { user: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user: me, isLoading: isAuthLoading } = useAuth();

  // /channel/me/manage/... 형태로 진입한 경우(예: SNS OAuth callback redirect)
  // 본인 채널 webPath 로 리다이렉트한다. me 가 여러 채널을 갖고 있다면 isOwner=true 첫 번째 사용.
  const isMeAlias = user === "me";
  const {
    data: myChannels,
    isLoading: isMyChannelsLoading,
    error: myChannelsError,
    refetch: refetchMyChannels,
  } = useMyChannel({
    enabled: isMeAlias && !!me?.id,
  });

  // me alias 일 때 비로그인 상태면 로그인 페이지로 보낸다 (current full path 를
  // ?from= 으로 보존). 로그인 후 동일 경로로 복귀해 SNS callback 쿼리스트링까지
  // 그대로 살릴 수 있다.
  useEffect(() => {
    if (!isMeAlias) return;
    if (isAuthLoading) return;
    if (me?.id) return;
    if (typeof window === "undefined") return;
    const fromUrl = `${pathname}${window.location.search}`;
    router.replace(`/auth/login?from=${encodeURIComponent(fromUrl)}`);
  }, [isMeAlias, isAuthLoading, me?.id, pathname, router]);

  useEffect(() => {
    if (!isMeAlias || !myChannels) return;
    const owned = myChannels.find((c) => c.isOwner) ?? myChannels[0];
    if (!owned) return;
    // pathname 의 'me' 만 실제 webPath 로 치환 (manage 이하 경로는 그대로 유지 → query 도 보존)
    const next = pathname.replace(
      /^\/channel\/me(\/|$)/,
      `/channel/${owned.webPath}$1`,
    );
    if (next !== pathname) {
      // 현재 search 도 그대로 유지 (callback 의 ?status=...&platform=...&reason=...)
      const search =
        typeof window !== "undefined" ? window.location.search : "";
      router.replace(`${next}${search}`);
    }
  }, [isMeAlias, myChannels, pathname, router]);

  // 유저 정보 조회 (존재 여부 확인)
  // me alias 일 때는 실제 채널이 결정되기 전이므로 /channel/me 조회는 의미 없음 → enabled=false
  const {
    data: userData,
    isLoading: isUserLoading,
    error: userError,
  } = useChannel(user || "", { enabled: !isMeAlias && !!user });

  const { data: userPermission, isLoading: isPermissionLoading } =
    useChannelPermission(user || "", { enabled: !isMeAlias && !!user });

  // 현재 섹션 계산
  const activeSection = useMemo((): ManagementSection => {
    const pathSegments = pathname.split("/");
    const manageIndex = pathSegments.findIndex(
      (segment) => segment === "manage",
    );
    const sectionSegment = pathSegments[manageIndex + 1];
    const foundItem = MANAGEMENT_MENU_ITEMS.find(
      (item) => item.id === sectionSegment,
    );
    return foundItem ? foundItem.id : "home";
  }, [pathname]);

  // 현재 섹션에 대한 권한 체크
  const hasPermissionForSection = useMemo(() => {
    if (!userPermission) return true; // 권한 로딩 중이면 일단 통과
    const checkFn = SECTION_PERMISSIONS[activeSection];
    return checkFn ? checkFn(userPermission) : false;
  }, [activeSection, userPermission]);

  // 어떤 관리 권한도 없으면 채널로 리다이렉트
  const hasAnyManagePermission = useMemo(() => {
    if (!userPermission) return true; // 로딩 중
    return (
      userPermission.isOwner ||
      userPermission.manageContent ||
      userPermission.manageSettings ||
      userPermission.manageProfile ||
      userPermission.manageGuestbook ||
      userPermission.manageCustomization ||
      userPermission.manageEmoticons
    );
  }, [userPermission]);

  // 권한 확인 후 리다이렉트
  useEffect(() => {
    if (userPermission && !hasAnyManagePermission) {
      router.replace(`/channel/${user}`);
    }
  }, [userPermission, hasAnyManagePermission, user, router]);

  // me alias 처리 — 세 가지 실패 모드를 안내 화면으로 변환 (Codex F6 review).
  // 정상 흐름은 위 useEffect 가 webPath 로 redirect 하므로 곧 사라진다.
  if (isMeAlias) {
    // 1) 비로그인 — 로그인 페이지로 redirect 진행 중. 빈 화면.
    if (!isAuthLoading && !me?.id) {
      return null;
    }

    // 2) auth/myChannels 로딩 중 — 빈 화면(짧은 깜빡임 방지).
    if (isAuthLoading || (me?.id && isMyChannelsLoading)) {
      return null;
    }

    // 3) myChannels 조회 실패 — 재시도 버튼 노출.
    if (myChannelsError) {
      return (
        <div className="p-6">
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>내 채널 정보를 불러오지 못했어요</AlertTitle>
            <AlertDescription className="flex flex-col gap-3">
              <span>잠시 후 다시 시도해주세요.</span>
              <button
                type="button"
                className="self-start rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent"
                onClick={() => {
                  void refetchMyChannels();
                }}
              >
                다시 불러오기
              </button>
            </AlertDescription>
          </Alert>
        </div>
      );
    }

    // 4) myChannels 가 비어있음 — 관리할 채널이 없음을 안내.
    if (myChannels && myChannels.length === 0) {
      return (
        <div className="p-6">
          <Alert>
            <AlertCircle className="size-4" />
            <AlertTitle>관리할 채널이 없습니다</AlertTitle>
            <AlertDescription>
              이 계정으로 관리할 수 있는 채널이 없습니다.
            </AlertDescription>
          </Alert>
        </div>
      );
    }

    // 5) 정상: redirect useEffect 가 곧 webPath 로 이동 — 빈 화면.
    return null;
  }

  // 유저 존재 여부 확인
  if (userError || (!isUserLoading && !userData)) {
    return <UserNotFoundError />;
  }

  // 권한 로딩 중
  if (isPermissionLoading) {
    return null;
  }

  // 어떤 관리 권한도 없으면 리다이렉트 처리 중
  if (userPermission && !hasAnyManagePermission) {
    return null;
  }

  // 현재 섹션 권한 없음
  if (!hasPermissionForSection) {
    const sectionLabel =
      MANAGEMENT_MENU_ITEMS.find((item) => item.id === activeSection)?.label ||
      activeSection;
    return <NoPermissionAlert section={sectionLabel} />;
  }

  return (
    <>
      <div className="container mx-auto min-h-[calc(100svh-64px)] md:px-4 mt-8 md:mt-0">
        <SectionErrorBoundary section="관리 도구">
          {activeSection === "home" && <HomeDashboard />}
          {activeSection === "songs" && <SongsManagementWrapper />}
          {activeSection === "songbook-download" && (
            <SongbookDownloadManagement user={user} />
          )}
          {activeSection === "add-song" && <AddSongSelection />}
          {activeSection === "categories" && <CategoriesManagement />}
          {activeSection === "artists" && <ArtistsManagement />}
          {activeSection === "song-requests" && <SongRequestsManagement />}
          {activeSection === "song-request-settings" && (
            <SongRequestSettingsContent user={user} />
          )}
          {activeSection === "session-history" && (
            <SessionHistory identifier={user} />
          )}
          {activeSection === "live" && <LiveManagementContent user={user} />}
          {activeSection === "schedule-settings" && (
            <ScheduleSettingsContent user={user} />
          )}
          {activeSection === "setlists" && <SetlistsManagement />}
          {activeSection === "wardrobe" && <WardrobeManagement />}
        </SectionErrorBoundary>
      </div>
    </>
  );
}
