"use client";

import { useChannel } from "@/meloming/domains/channel/hooks/use-channel";
import clsx from "clsx";
import { cn } from "@/meloming/shared/lib/utils";
import UserAvatar from "./user-avatar";
import { useIsMobile } from "@/meloming/shared/hooks/use-mobile";
import { Button } from "@/meloming/shared/components/ui/button";
import { useMusicbookFilters } from "@/meloming/domains/channel/hooks/use-musicbook-filters";
import type { Channel } from "../../types/channel";
import { getContrastingTextColor } from "@/meloming/shared/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/meloming/shared/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import {
  getAllConfiguredChannelMenuItems,
  getPathFromTab,
  type ChannelFeatureSettings,
  type ChannelTab,
} from "@/meloming/domains/channel/types/channel-tab";
import Link from "next/link";
import React from "react";

interface UserMenuProps {
  userId: string;
  userData?: Channel; // userData가 전달되면 API 호출하지 않음
  guestbookEnabled?: boolean; // 서버에서 전달받은 방명록 활성화 여부
  setlistEnabled?: boolean; // 신청곡 세션 기록이 있어 셋리스트 탭을 노출할지 여부
  featureSettings?: ChannelFeatureSettings;
}

interface MenuTabProps {
  title: string;
  tabName: ChannelTab;
  isActive: boolean;
  href: string;
  themeColor: string | undefined;
  isNew?: boolean;
}

const MenuTab = ({
  title,
  tabName,
  isActive,
  href,
  themeColor,
  isNew,
}: MenuTabProps) => {
  const buttonEl = (
    <Button
      id={`channel-nav-${tabName}`}
      variant={isActive && themeColor ? "default" : "ghost"}
      className={clsx(
        "text-lg font-medium px-4 shrink-0 paperlogy channel-nav-tab",
        isActive && "font-semibold"
      )}
      style={{
        backgroundColor: isActive ? themeColor : undefined,
        color: isActive
          ? getContrastingTextColor(themeColor || "")
          : undefined,
      }}
    >
      <span className="flex items-center gap-1">
        {title}
        {isNew && (
          <span
            className="bg-orange-400 text-white font-bold rounded-full w-4 h-4 flex items-center justify-center"
            style={{ fontSize: "9px" }}
          >
            N
          </span>
        )}
      </span>
    </Button>
  );

  return <Link href={href}>{buttonEl}</Link>;
};

export default function UserMenu({
  userId,
  userData: userDataProp,
  guestbookEnabled = true,
  setlistEnabled = false,
  featureSettings,
}: UserMenuProps) {
  const { data: userFetched, isLoading } = useChannel(userId, {
    enabled: !userDataProp, // userData가 없을 때만 API 호출
  });
  const isMobile = useIsMobile();
  const { filters } = useMusicbookFilters();

  const { tab: currentTab } = filters;

  // 전달받은 userData 우선 사용, 없으면 API 호출 결과 사용
  const userData = userDataProp || userFetched;
  const webPath = userData?.webPath || userId;
  const isWide = userData?.layoutWidth === "wide";

  // 탭 가시성 결정: 방명록 비활성화 시 방명록 탭 숨김, 셋리스트 미보유 시 셋리스트 탭 숨김
  const visibleTabs = React.useMemo(() => {
    return getAllConfiguredChannelMenuItems(featureSettings).filter(
      (item) => {
        if (item.tabName === "guestbook" && !guestbookEnabled) return false;
        if (item.tabName === "setlist" && !setlistEnabled) return false;
        if (item.tabName === "content" && !userData?.isVerified) return false;
        return true;
      }
    );
  }, [
    guestbookEnabled,
    setlistEnabled,
    userData?.isVerified,
    featureSettings,
  ]);

  const getTabHref = React.useCallback(
    (tabName: ChannelTab) => getPathFromTab(webPath, tabName),
    [webPath]
  );

  const activeConfiguredTab = visibleTabs.find(
    (item) => item.tabName === currentTab
  );

  const currentTabLabel = activeConfiguredTab?.title || "홈";

  // isSticky 상태를 내부에서 관리
  const [isSticky, setIsSticky] = React.useState(false);

  React.useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY;
      const triggerPoint = 200;
      setIsSticky(scrollY > triggerPoint);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // position:sticky 가 아니라 isSticky 시 position:fixed 로 전환한다.
  // 이유: Radix Dropdown/Dialog/Select 류가 열리면 react-remove-scroll 이 body 에
  // overflow:hidden (+ 모바일에선 position:fixed + top:-scrollY) 을 주입하는데,
  // 이 순간 position:sticky 의 containing block 이 viewport → body 로 재할당되며
  // sticky element 가 scrollY 만큼 viewport 위로 튀어 사라진다.
  // NewShell 사이드바가 sticky→fixed 로 옮긴 것과 동일 이유.
  // placeholder 는 fixed 전환 시 in-flow 자리를 보존해 layout shift 를 막는다.
  const navRef = React.useRef<HTMLElement>(null);
  const [navHeight, setNavHeight] = React.useState(0);

  React.useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const measure = () => setNavHeight(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <>
      {isSticky && (
        <div aria-hidden className="mt-4" style={{ height: navHeight }} />
      )}
      <section
        ref={navRef}
        id="channel-nav"
        className={clsx(
          "border-b z-40 bg-background",
          isSticky
            ? "fixed top-[var(--page-content-sticky-top)] left-0 right-0 md:left-[var(--rail-width,0px)]"
            : "mt-4"
        )}
      >
      <section
        className={cn(
          !isWide && "container",
          "mx-auto py-2.5 px-4 md:px-6",
          isMobile ? "flex flex-col gap-4" : "flex flex-row gap-6 items-start"
        )}
      >
        <div
          className={clsx(
            "flex items-center flex-1",
            isMobile ? "flex-row justify-between" : "flex-row gap-4"
          )}
        >
          {isSticky && userData && !isLoading && (
            <div className="flex flex-row gap-2 items-center mr-2">
              <UserAvatar
                userName={userData?.name || ""}
                profileImageUrl={userData.profileImageUrl}
                className={clsx(
                  "w-12 h-12 rounded-full object-cover select-none",
                  isMobile && "w-10 h-10"
                )}
              />

              <div
                className={clsx(
                  "font-bold text-xl paperlogy",
                  isMobile && "text-base"
                )}
              >
                {userData?.name}
              </div>
            </div>
          )}

          {/* 모바일 스티키 상태일 때 드롭다운 메뉴 */}
          {isSticky && isMobile && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="ml-auto px-4 paperlogy font-semibold text-base"
                  style={{
                    backgroundColor: userData?.themeColor,
                    color: getContrastingTextColor(userData?.themeColor || ""),
                    // color: userData?.themeColor,
                    // borderColor: userData?.themeColor,
                  }}
                >
                  {currentTabLabel}
                  <ChevronDown className="ml-2 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                {visibleTabs.map((item) => {
                  const href = getTabHref(item.tabName);
                  const inner = (
                    <span className="flex items-center gap-1">
                      {item.title}
                      {item.isNew && (
                        <span
                          className="bg-orange-400 text-white font-bold rounded-full w-4 h-4 flex items-center justify-center"
                          style={{ fontSize: "9px" }}
                        >
                          N
                        </span>
                      )}
                    </span>
                  );
                  // Radix canonical 패턴: DropdownMenuItem asChild 로 Link/a 를
                  // 직접 자식으로 두면 동일 노드가 menuitem 역할 + 네비게이션을 함께
                  // 수행해 tap-through (트리거 pointerdown → menu open → 첫 항목으로
                  // pointerup 이 흐르며 즉시 클릭) 문제가 사라진다.
                  return (
                    <DropdownMenuItem
                      key={item.tabName}
                      asChild
                      className={clsx(
                        "paperlogy cursor-pointer flex justify-between items-center",
                        currentTab === item.tabName && "font-semibold"
                      )}
                    >
                      <Link href={href}>{inner}</Link>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <div
            className={clsx(
              "flex items-start w-full min-w-0 flex-1 overflow-x-auto overflow-y-hidden scrollbar-hide touch-pan-x overscroll-x-contain overscroll-y-none",
              isMobile ? "flex-row gap-1" : "flex-row gap-1",
              isSticky && !isMobile && "ml-auto",
              isSticky && isMobile && "hidden"
            )}
            onWheel={(e) => {
              const element = e.currentTarget;
              // Convert vertical wheel to horizontal scroll to keep page from moving
              if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                element.scrollLeft += e.deltaY;
                e.preventDefault();
              }
            }}
          >
            {visibleTabs.map((item) => (
              <MenuTab
                key={item.tabName}
                title={item.title}
                tabName={item.tabName}
                isActive={currentTab === item.tabName}
                href={getTabHref(item.tabName)}
                themeColor={userData?.themeColor}
                isNew={item.isNew}
              />
            ))}
          </div>
        </div>
      </section>
    </section>
    </>
  );
}
