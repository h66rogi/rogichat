"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useSidebar } from "@/meloming/shared/components/ui/sidebar";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
} from "@/meloming/shared/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/meloming/shared/components/ui/collapsible";
import { Switch } from "@/meloming/shared/components/ui/switch";
import {
  ChevronRight,
  LayoutDashboard,
  Gamepad2,
  BookOpen,
  ListOrdered,
  Palette,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/meloming/shared/lib/utils";
import type { ManagementSection, ManagementMenuItem, ManagementGroup } from "./types";
import { MANAGEMENT_MENU_ITEMS, MANAGEMENT_GROUPS } from "./types";

const GROUP_ICONS: Record<ManagementGroup, LucideIcon> = {
  [MANAGEMENT_GROUPS.SONGBOOK]: BookOpen,
  [MANAGEMENT_GROUPS.SONG_REQUEST]: ListOrdered,
  [MANAGEMENT_GROUPS.CONTENT]: Palette,
  [MANAGEMENT_GROUPS.SETTINGS]: Settings,
};
import { useChannelPermission } from "@/meloming/domains/channel/hooks/use-channel";
import type { GetChannelIdentifierPermissionResponse } from "@/meloming/domains/channel/types/channel";
import { usePublicActiveSession } from "@/meloming/domains/overlay/hooks/use-public-session";
import {
  useEndSession,
  useStartSession,
  useUpdateSessionSettings,
} from "@/meloming/domains/overlay/hooks/use-session";
import { toast } from "sonner";
import { extractApiErrorMessage } from "@/meloming/shared/lib/api-error";
import { EndSessionConfirmDialog } from "@/meloming/domains/overlay/components/end-session-confirm-dialog";

interface ManagementSidebarContentProps {
  activeSection: ManagementSection;
  showGroupTitles?: boolean;
}

/**
 * 섹션별 필요 권한 정의
 */
const SECTION_PERMISSIONS: Partial<Record<ManagementSection, (p: GetChannelIdentifierPermissionResponse) => boolean>> = {
  home: p => p.isOwner || p.manageContent || p.manageSettings,
  songs: p => p.isOwner || p.manageContent,
  "songbook-download": p => p.isOwner || p.manageContent,
  "add-song": p => p.isOwner || p.manageContent,
  categories: p => p.isOwner || p.manageContent,
  artists: p => p.isOwner || p.manageContent,
  "song-requests": p => p.isOwner || p.manageContent,
  "clip-requests": p => p.isOwner || p.manageContent,
  live: p => p.isOwner || p.manageSettings,
  console: p => p.isOwner || p.manageSettings,
  "song-request-settings": p => p.isOwner || p.manageSettings,
  "session-history": p => p.isOwner || p.manageSettings,
  "schedule-settings": p => p.isOwner || p.manageContent,
  setlists: p => p.isOwner || p.manageContent,
  wardrobe: p => p.isOwner || p.manageContent,
  settings: p => p.isOwner || p.manageSettings,
};

// 그룹 컴포넌트 (접이식)
function MenuGroup({
  groupKey,
  items,
  activeSection,
  defaultOpen,
  onNavigate,
  getUrlForSection,
  extraButton,
}: {
  groupKey: ManagementGroup;
  items: ManagementMenuItem[];
  activeSection: ManagementSection;
  defaultOpen?: boolean;
  onNavigate: () => void;
  getUrlForSection: (id: ManagementSection) => string;
  extraButton?: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen ?? false);

  const hasActiveItem = items.some(
    (item) =>
      activeSection === item.id || activeSection.startsWith(`${item.id}/`)
  );

  // 선택된 탭이 이 그룹에 새로 들어올 때만 자동 펼침.
  // React 공식 "render 중 derived state" 패턴 — hasActiveItem 이 false→true 로 바뀐
  // 순간에만 setIsOpen(true) 호출해 사용자가 수동으로 닫은 상태를 존중한다.
  const [prevHasActive, setPrevHasActive] = useState(hasActiveItem);
  if (hasActiveItem !== prevHasActive) {
    setPrevHasActive(hasActiveItem);
    if (hasActiveItem) setIsOpen(true);
  }

  if (items.length === 0) return null;

  const GroupIcon = GROUP_ICONS[groupKey];

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className="group/collapsible"
    >
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            isActive={hasActiveItem && !isOpen}
            className={cn(
              "w-full justify-start gap-3.5 items-center h-11 px-3.5 cursor-pointer rounded-full font-bold",
              hasActiveItem
                ? "text-indigo-700 dark:text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/15"
                : "text-foreground hover:bg-muted"
            )}
          >
            {GroupIcon && (
              <GroupIcon
                className={cn(
                  "size-[22px]! shrink-0",
                  hasActiveItem
                    ? "text-indigo-600 dark:text-indigo-400"
                    : "text-muted-foreground"
                )}
              />
            )}
            <span className="flex-1 text-[16px]">{groupKey}</span>
            <ChevronRight
              className={cn(
                "size-4 transition-transform duration-200 shrink-0",
                isOpen && "rotate-90"
              )}
            />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub className="ml-[1.625rem] pl-3 pr-0 mr-0 border-l border-border/60 gap-1 mt-1">
            {items.map((item) => {
              const isActive = activeSection === item.id;

              return (
                <SidebarMenuSubItem key={item.id}>
                  <SidebarMenuSubButton
                    asChild
                    isActive={isActive}
                    className={cn(
                      "h-10 px-3.5 rounded-full transition-colors",
                      isActive
                        ? "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 font-semibold hover:bg-indigo-500/15 hover:text-indigo-700 dark:hover:text-indigo-300 data-[active=true]:bg-indigo-500/10 data-[active=true]:text-indigo-700 dark:data-[active=true]:text-indigo-300"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                  >
                    <Link
                      href={getUrlForSection(item.id)}
                      onClick={onNavigate}
                    >
                      <span className="text-[15px]">{item.label}</span>
                      {item.badge && (
                        <span
                          className={cn(
                            "ml-auto text-[10px] font-bold leading-none rounded px-1.5 py-0.5",
                            item.badge === "NEW"
                              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                              : item.badge === "준비중"
                                ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
                                : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                          )}
                        >
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              );
            })}
            {extraButton}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

/**
 * 관리 사이드바 콘텐츠 클라이언트 컴포넌트
 */
export function ManagementSidebarContent({
  activeSection,
}: ManagementSidebarContentProps) {
  const params = useParams();
  const user = params?.user as string | undefined;
  const { isMobile, setOpenMobile } = useSidebar();
  const { data: permission } = useChannelPermission(user || "");
  const canAccessSongRequestOverlay = Boolean(permission?.isOwner || permission?.manageSettings);
  const {
    data: publicSession,
    isLoading: isPublicSessionLoading,
    refetch: refetchPublicSession,
  } = usePublicActiveSession(user, {
    enabled: Boolean(user && canAccessSongRequestOverlay),
    refetchInterval: 30_000,
  });
  const updateSessionSettingsMutation = useUpdateSessionSettings(user);
  const startSessionMutation = useStartSession(user);
  const endSessionMutation = useEndSession(user);
  const [requestModeOverride, setRequestModeOverride] = useState<boolean | null>(
    null
  );

  const liveSessionId = publicSession?.sessionId ?? null;
  const isLiveSessionActive = Boolean(publicSession?.isLive && liveSessionId);
  const requestModeFromSession = publicSession?.settings?.requestEnabled ?? false;
  const requestModeEnabled = requestModeOverride ?? requestModeFromSession;
  const requestModeDisabled =
    isPublicSessionLoading ||
    startSessionMutation.isPending ||
    updateSessionSettingsMutation.isPending ||
    endSessionMutation.isPending ||
    !canAccessSongRequestOverlay;

  const handleNavigate = () => {
    if (isMobile) setOpenMobile(false);
  };

  const [endConfirmOpen, setEndConfirmOpen] = useState(false);

  const handleSidebarRequestModeChange = async (checked: boolean) => {
    if (!checked) {
      if (!liveSessionId) return;
      setEndConfirmOpen(true);
      return;
    }

    setRequestModeOverride(checked);
    try {
      if (!liveSessionId) {
        await startSessionMutation.mutateAsync({});
        await refetchPublicSession();
        setRequestModeOverride(null);
        toast.success("신청곡 모드를 시작했습니다");
        return;
      }

      await updateSessionSettingsMutation.mutateAsync({
        sessionId: liveSessionId,
        settings: { requestEnabled: checked },
      });
      await refetchPublicSession();
      setRequestModeOverride(null);
      toast.success("신청곡 모드를 켰습니다");
    } catch (error: unknown) {
      setRequestModeOverride(null);
      const message = extractApiErrorMessage(
        error,
        "신청곡 모드 변경에 실패했습니다"
      );
      toast.error(message);
    }
  };

  const handleConfirmEndSession = async () => {
    if (!liveSessionId) {
      setEndConfirmOpen(false);
      return;
    }
    try {
      await endSessionMutation.mutateAsync(liveSessionId);
      await refetchPublicSession();
      toast.success("신청곡 모드를 끄고 세션을 종료했습니다");
      setEndConfirmOpen(false);
    } catch (error: unknown) {
      const message = extractApiErrorMessage(
        error,
        "신청곡 모드 변경에 실패했습니다"
      );
      toast.error(message);
    }
  };

  const getUrlForSection = (sectionId: ManagementSection): string => {
    if (sectionId === "home") {
      return `/channel/${user}/manage`;
    }
    return `/channel/${user}/manage/${sectionId}`;
  };

  // 권한에 따라 메뉴 아이템 필터링
  // permission이 아직 로드되지 않았을 때는 메뉴를 비운다 (이전에는 원본을 그대로 반환해서
  // 피처 플래그 가드가 우회됐었음 — emoticons, sync 등 플래그가 꺼져도 잠깐 노출됐다).
  const filterByPermission = (items: ManagementMenuItem[]) => {
    if (!permission) return [];
    return items.filter((item) => {
      const checkFn = SECTION_PERMISSIONS[item.id];
      return checkFn ? checkFn(permission) : false;
    });
  };

  // 그룹별 아이템 필터링 및 기본 열림 상태
  const songbookItems = useMemo(() => {
    const items = MANAGEMENT_MENU_ITEMS.filter(
      (item) => item.group === MANAGEMENT_GROUPS.SONGBOOK
    );
    return filterByPermission(items);
  }, [
    canAccessSongRequestOverlay,
    permission,
  ]);

  const songbookDefaultOpen = useMemo(() => {
    return songbookItems.some(
      (item) => activeSection === item.id || activeSection.startsWith(`${item.id}/`)
    );
  }, [activeSection, songbookItems]);

  const songRequestItems = useMemo(() => {
    const items = MANAGEMENT_MENU_ITEMS.filter(
      (item) => item.group === MANAGEMENT_GROUPS.SONG_REQUEST
    );
    return filterByPermission(items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    canAccessSongRequestOverlay,
    permission,
  ]);

  const songRequestDefaultOpen = useMemo(() => {
    return songRequestItems.some(
      (item) => activeSection === item.id || activeSection.startsWith(`${item.id}/`)
    );
  }, [activeSection, songRequestItems]);

  const contentItems = useMemo(() => {
    const items = MANAGEMENT_MENU_ITEMS.filter(
      (item) => item.group === MANAGEMENT_GROUPS.CONTENT
    );
    return filterByPermission(items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    canAccessSongRequestOverlay,
    permission,
  ]);

  const contentDefaultOpen = useMemo(() => {
    return contentItems.some(
      (item) => activeSection === item.id || activeSection.startsWith(`${item.id}/`)
    );
  }, [activeSection, contentItems]);

  const settingsItems = useMemo(() => {
    const items = MANAGEMENT_MENU_ITEMS.filter(
      (item) => item.group === MANAGEMENT_GROUPS.SETTINGS
    );
    return filterByPermission(items);
  }, [permission]);

  const settingsDefaultOpen = useMemo(() => {
    return settingsItems.some(
      (item) => activeSection === item.id || activeSection.startsWith(`${item.id}/`)
    );
  }, [activeSection, settingsItems]);

  return (
    <>
    <div className="flex flex-col h-full">
      {/* 상단 HERO: 신청곡 모드 (토글) + 리모컨 */}
      {canAccessSongRequestOverlay && (
        <div className="px-1.5 pb-3 border-b border-border/50 space-y-2">
          {/* 신청곡 모드 - HERO card (solid indigo) */}
          <div
            className={cn(
              "relative overflow-hidden rounded-xl px-3.5 py-3 shadow-lg shadow-indigo-500/20 transition-colors",
              isLiveSessionActive
                ? "bg-gradient-to-br from-indigo-500 to-indigo-600"
                : "bg-gradient-to-br from-indigo-500/90 to-indigo-600/90"
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-white">신청곡 모드</p>
                <p className="text-[11px] text-white/80 mt-0.5 leading-tight">
                  {isLiveSessionActive
                    ? "활성 중 · 끄면 세션 종료"
                    : "켜면 시청자가 곡을 신청할 수 있어요"}
                </p>
              </div>
              <Switch
                checked={requestModeEnabled}
                disabled={requestModeDisabled}
                onCheckedChange={handleSidebarRequestModeChange}
                className="data-[state=checked]:bg-white data-[state=unchecked]:bg-white/30 [&>span]:data-[state=checked]:bg-indigo-600"
              />
            </div>
          </div>

          {/* 리모컨 - Secondary CTA */}
          <Link
            href={getUrlForSection("live")}
            onClick={handleNavigate}
            className={cn(
              "w-full group flex items-center justify-center gap-2 px-3 py-3 rounded-full",
              "border-2 border-indigo-500/40 bg-indigo-500/5 text-indigo-700 dark:text-indigo-300",
              "hover:bg-indigo-500/10 hover:border-indigo-500/60 transition-colors font-semibold"
            )}
          >
            <Gamepad2 className="size-4" />
            <span className="text-sm">라이브 신청곡 관리</span>
          </Link>
        </div>
      )}

      {/* 메인 메뉴 그룹들 */}
      <div className="flex-1 overflow-y-auto px-0.5 py-3">
        <SidebarMenu className="space-y-1">
          {/* 대시보드 */}
          <SidebarMenuItem>
            <Link
              href={getUrlForSection("home")}
              onClick={handleNavigate}
            >
              <SidebarMenuButton
                isActive={activeSection === "home"}
                className={cn(
                  "w-full h-11 px-3.5 gap-3.5 rounded-full font-bold text-[16px]",
                  activeSection === "home"
                    ? "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/15 hover:text-indigo-700 dark:hover:text-indigo-300"
                    : "text-foreground hover:bg-muted"
                )}
              >
                <LayoutDashboard
                  className={cn(
                    "size-[22px]! shrink-0",
                    activeSection === "home"
                      ? "text-indigo-600 dark:text-indigo-400"
                      : "text-muted-foreground"
                  )}
                />
                <span className="text-[16px]">대시보드</span>
              </SidebarMenuButton>
            </Link>
          </SidebarMenuItem>
          {/* 노래책 */}
          <MenuGroup
            groupKey={MANAGEMENT_GROUPS.SONGBOOK}
            items={songbookItems}
            activeSection={activeSection}
            defaultOpen={songbookDefaultOpen}
            onNavigate={handleNavigate}
            getUrlForSection={getUrlForSection}
          />

          {/* 신청곡 */}
          <MenuGroup
            groupKey={MANAGEMENT_GROUPS.SONG_REQUEST}
            items={songRequestItems}
            activeSection={activeSection}
            defaultOpen={songRequestDefaultOpen}
            onNavigate={handleNavigate}
            getUrlForSection={getUrlForSection}
          />

          {/* 콘텐츠 관리 */}
          <MenuGroup
            groupKey={MANAGEMENT_GROUPS.CONTENT}
            items={contentItems}
            activeSection={activeSection}
            defaultOpen={contentDefaultOpen}
            onNavigate={handleNavigate}
            getUrlForSection={getUrlForSection}
          />

          <MenuGroup
            groupKey={MANAGEMENT_GROUPS.SETTINGS}
            items={settingsItems}
            activeSection={activeSection}
            defaultOpen={settingsDefaultOpen}
            onNavigate={handleNavigate}
            getUrlForSection={getUrlForSection}
          />

        </SidebarMenu>
      </div>
    </div>
    <EndSessionConfirmDialog
      open={endConfirmOpen}
      onOpenChange={(next) => {
        if (!next && !endSessionMutation.isPending) setEndConfirmOpen(false);
      }}
      onConfirm={() => void handleConfirmEndSession()}
      isPending={endSessionMutation.isPending}
    />
    </>
  );
}
