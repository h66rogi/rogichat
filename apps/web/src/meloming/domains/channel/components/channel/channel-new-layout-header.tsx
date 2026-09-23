"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Settings,
} from "lucide-react";
import UserHeader from "./user-header";
import { TAB_ICONS } from "./channel-menu-sidebar";
import { useChannelCalendarHeaderControls } from "./channel-calendar-header-controls";
import {
  SectionHeaderV3,
  BrandIconTitle,
} from "@/meloming/shared/components/common/section-header-v3";
import { SectionHeaderTabs } from "@/meloming/shared/components/common/section-header-tabs";
import {
  SectionHeaderActionLink,
  sectionHeaderPillClass,
} from "@/meloming/shared/components/common/section-header-actions";
import { Calendar } from "@/meloming/shared/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/meloming/shared/components/ui/popover";
import { ChannelTabHelpDialog } from "./channel-tab-help-dialog";
import { CalendarSearchButton } from "@/meloming/domains/calendar/components/CalendarSearch";
import {
  getTabFromPath,
  getChannelFeatureSetting,
  getTabDescription,
  type ChannelFeatureSettings,
  type ChannelTab,
} from "@/meloming/domains/channel/types/channel-tab";
import {
  useChannelFeatureSettings,
  useChannelPermission,
} from "@/meloming/domains/channel/hooks/use-channel";
import {
  CHANNEL_CONTENT_TAB_PARAM,
  CHANNEL_CONTENT_TABS,
  parseChannelContentTab,
  type ChannelContentRelationTab,
} from "@/meloming/domains/channel/components/channel-content-tabs";
import type {
  Channel,
  GetChannelIdentifierPermissionResponse,
} from "@/meloming/domains/channel/types/channel";
import type { ManagementSection } from "@/meloming/domains/channel/components/management/types";

interface BannerProps {
  user: string;
  channelData: Channel;
  permissionData: GetChannelIdentifierPermissionResponse | null;
}

/**
 * 신규 레이아웃 콘텐츠 영역의 배너 배경.
 * 홈 탭에서만 노출한다 (다른 탭은 SectionHeaderV3 만).
 */
export function ChannelNewLayoutBanner({
  user,
  channelData,
  permissionData,
}: BannerProps) {
  const pathname = usePathname() ?? "";
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "channel" || parts.length !== 2) return null;
  return (
    // 홈 배너는 카드 우상단 모서리에 닿으므로 rounded-tr 로 clip (카드 overflow-hidden 불가 대응).
    <div className="relative md:overflow-hidden md:rounded-tr-xl">
      <UserHeader
        userId={user}
        userData={channelData}
        userPermission={permissionData}
        variant="banner"
      />
    </div>
  );
}

/**
 * 신규 레이아웃 각 탭 페이지 상단 헤더 (SectionHeaderV3).
 * 홈 탭은 배너가 헤더 역할을 하므로 렌더하지 않는다.
 */
export function ChannelNewLayoutHeader({
  user,
  isWide = false,
  permissionData,
  initialFeatureSettings,
}: {
  user: string;
  isWide?: boolean;
  permissionData?: GetChannelIdentifierPermissionResponse | null;
  initialFeatureSettings?: ChannelFeatureSettings;
}) {
  const pathname = usePathname() ?? "";
  const { data: featureSettings } = useChannelFeatureSettings(user, {
    initialData: initialFeatureSettings,
  });
  const { data: permission } = useChannelPermission(user, {
    initialData: permissionData,
  });
  const calendarControls = useChannelCalendarHeaderControls();
  const tab = getTabFromPath(pathname);
  if (tab === "home") return null;
  const Icon = TAB_ICONS[tab];
  const description = getTabDescription(tab);
  const title = getChannelFeatureSetting(featureSettings, tab).label;
  const isScheduleCalendar = tab === "schedule" && !!calendarControls;
  const isContentTab = tab === "content";
  const manageAction = getTabManageAction(user, tab, permission);
  return (
    // 다른 페이지(section-page-layout 등)의 SectionHeaderV3 사용과 동일하게 — 특수 폭/패딩 옵션 없이
    // 기본(container mx-auto + px-4)을 쓴다. 콘텐츠 영역도 동일한 container 로 정렬한다.
    // ChannelShell 의 실제 고정 헤더 높이(모바일 64px / 데스크톱 46px) 아래에 붙인다.
    // 데스크톱에서 card-gap(8px)을 쓰면 ThinHeader 뒤로 38px 가려진다.
    <div className="sticky top-[var(--site-sticky-top)] z-30 md:overflow-hidden md:rounded-tr-xl">
      <SectionHeaderV3
        sticky={false}
        isWide={isWide}
        brand={
          <div className="flex min-w-0 items-center gap-1.5">
            <BrandIconTitle icon={Icon} title={title} />
            <ChannelTabHelpDialog
              tab={tab}
              title={title}
              icon={Icon}
              description={description}
            />
          </div>
        }
        center={
          isScheduleCalendar ? (
            <ChannelCalendarHeaderCenter controls={calendarControls} />
          ) : isContentTab ? (
            <ChannelContentHeaderCenter />
          ) : undefined
        }
        actions={
          isScheduleCalendar ? (
            <ChannelCalendarHeaderActions controls={calendarControls} user={user} />
          ) : manageAction ? (
            <SectionHeaderActionLink
              href={manageAction.href}
              label={manageAction.label}
              icon={Settings}
            />
          ) : undefined
        }
      />
    </div>
  );
}

type ManagePermission =
  | GetChannelIdentifierPermissionResponse
  | null
  | undefined;

type HeaderManageActionConfig = {
  section?: ManagementSection;
  href?: string | ((user: string) => string);
  label: string;
  canAccess: (permission: GetChannelIdentifierPermissionResponse) => boolean;
};

const canManageContent = (permission: GetChannelIdentifierPermissionResponse) =>
  permission.isOwner || permission.manageContent;

const canManageSettings = (permission: GetChannelIdentifierPermissionResponse) =>
  permission.isOwner || permission.manageSettings;

const TAB_MANAGE_ACTIONS = {
  home: {
    section: "settings",
    label: "채널 관리",
    canAccess: canManageSettings,
  },
  musicbook: {
    section: "songs",
    label: "노래 관리",
    canAccess: canManageContent,
  },
  setlist: {
    section: "setlists",
    label: "셋리스트 관리",
    canAccess: canManageContent,
  },
  schedule: {
    section: "schedule-settings",
    label: "일정 관리",
    canAccess: canManageContent,
  },
  wardrobe: {
    section: "wardrobe",
    label: "옷장 관리",
    canAccess: canManageContent,
  },
  guestbook: {
    section: "guestbook-settings",
    label: "방명록 설정",
    canAccess: canManageSettings,
  },
  info: {
    section: "settings",
    label: "채널 관리",
    canAccess: canManageSettings,
  },
  content: {
    href: "/content/create",
    label: "콘텐츠 등록",
    canAccess: canManageContent,
  },
} satisfies Record<ChannelTab, HeaderManageActionConfig>;

function getManageHref(user: string, config: HeaderManageActionConfig) {
  if (typeof config.href === "function") return config.href(user);
  if (config.href) return config.href;
  if (config.section) return `/channel/${user}/manage/${config.section}`;
  return null;
}

function buildManageAction(
  user: string,
  config: HeaderManageActionConfig,
  permission: ManagePermission
) {
  if (!permission || !config.canAccess(permission)) return null;
  const href = getManageHref(user, config);
  if (!href) return null;
  return {
    href,
    label: config.label,
  };
}

function getTabManageAction(
  user: string,
  tab: ChannelTab,
  permission: ManagePermission
) {
  return buildManageAction(user, TAB_MANAGE_ACTIONS[tab], permission);
}

function ChannelContentHeaderCenter() {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const activeTab = parseChannelContentTab(
    searchParams.get(CHANNEL_CONTENT_TAB_PARAM),
  );

  const handleTabChange = (tab: ChannelContentRelationTab) => {
    const next = new URLSearchParams(searchParams.toString());
    if (tab === "hosted") next.delete(CHANNEL_CONTENT_TAB_PARAM);
    else next.set(CHANNEL_CONTENT_TAB_PARAM, tab);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  };

  return (
    <SectionHeaderTabs
      ariaLabel="콘텐츠 보기 방식"
      value={activeTab}
      onValueChange={(value) =>
        handleTabChange(value as ChannelContentRelationTab)
      }
      items={CHANNEL_CONTENT_TABS.map((tab) => ({
        value: tab.value,
        label: tab.label,
      }))}
    />
  );
}

function ChannelCalendarHeaderCenter({
  controls,
}: {
  controls: NonNullable<ReturnType<typeof useChannelCalendarHeaderControls>>;
}) {
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  return (
    <div className="flex min-w-0 items-center justify-center gap-1.5">
      <button
        type="button"
        onClick={controls.onToday}
        disabled={controls.isFetching}
        className={sectionHeaderPillClass()}
      >
        오늘
      </button>
      <button
        type="button"
        onClick={controls.onPrevious}
        disabled={controls.isFetching}
        aria-label={controls.viewMode === "week" ? "이전 주" : "이전 달"}
        className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
      >
        <ChevronLeft className="size-4" />
      </button>
      <h2 className="min-w-28 truncate text-center text-xl font-medium tracking-normal sm:min-w-36 sm:text-2xl">
        {controls.title}
      </h2>
      <button
        type="button"
        onClick={controls.onNext}
        disabled={controls.isFetching}
        aria-label={controls.viewMode === "week" ? "다음 주" : "다음 달"}
        className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
      >
        <ChevronRight className="size-4" />
      </button>
      <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="날짜 선택"
            className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <CalendarIcon className="size-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="center">
          <Calendar
            mode="single"
            selected={controls.selectedDate}
            onSelect={(date) => {
              controls.onDateSelect(date);
              setDatePickerOpen(false);
            }}
            defaultMonth={controls.defaultMonth}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function ChannelCalendarHeaderActions({
  controls,
  user,
}: {
  controls: NonNullable<ReturnType<typeof useChannelCalendarHeaderControls>>;
  user: string;
}) {
  return (
    <>
      <CalendarSearchButton
        identifier={user}
        onSelectDate={controls.onDateSelect}
        align="end"
      />
      <SectionHeaderTabs
        ariaLabel="캘린더 보기 방식"
        value={controls.viewMode}
        onValueChange={(value) =>
          controls.onViewModeChange(value as "week" | "month")
        }
        items={[
          { value: "week", label: "주간" },
          { value: "month", label: "월간" },
        ]}
      />
      {controls.manageHref ? (
        <SectionHeaderActionLink
          href={controls.manageHref}
          label="일정 관리"
          icon={Settings}
        />
      ) : null}
    </>
  );
}
