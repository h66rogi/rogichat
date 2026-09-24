import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  HelpCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/meloming/shared/components/ui/dialog";
import { useIsMobile } from "@/meloming/shared/hooks/use-mobile";
import { Button } from "@/meloming/shared/components/ui/button";
import { cn } from "@/meloming/shared/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/meloming/shared/components/ui/popover";
import { Calendar } from "@/meloming/shared/components/ui/calendar";
import { useChannelSchedules } from "@/meloming/domains/schedule/hooks/use-schedules";
import type { Schedule } from "@/meloming/domains/schedule/types/schedule";
import type { CalendarAnniversary } from "@/meloming/domains/schedule/types/anniversary";
import { FavoriteMonthlyCalendar } from "@/meloming/domains/schedule/components/monthly/FavoriteMonthlyCalendar";
import { MobileMonthlyCalendar } from "@/meloming/domains/schedule/components/monthly/MobileMonthlyCalendar";
import { Skeleton } from "@/meloming/shared/components/ui/skeleton";
import { DesktopWeeklyGrid } from "./weekly/DesktopWeeklyGrid";
import { MobileWeeklyAgenda } from "./weekly/MobileWeeklyAgenda";
import {
  DesktopWeeklyGridSkeleton,
  MobileDaySelectorSkeleton,
} from "./weekly/ScheduleCardSkeleton";
import {
  getNextWeek,
  getPreviousWeek,
  getWeekEnd,
  getWeekNumber,
  getWeekStart,
} from "@/meloming/shared/lib/week-utils";
import { useChannelCalendar } from "@/meloming/domains/calendar/hooks/use-channel-calendar";
import { useChannelCalendarV2Flag } from "@/meloming/domains/calendar/hooks/use-channel-calendar-flag";
import { CalendarSearchButton } from "@/meloming/domains/calendar/components/CalendarSearch";
import { setChannelCalendarHeaderControls } from "@/meloming/domains/channel/components/channel/channel-calendar-header-controls";
import type {
  CalendarBroadcastRecord,
  CalendarClipRecord,
} from "@/meloming/domains/calendar/types/channel-calendar";

type WeeklyScheduleViewerProps = {
  channelId: number;
  /**
   * 채널 식별자 (webPath 또는 numeric id). v2 통합 캘린더 endpoint
   * (`GET /v1/channels/:identifier/calendar`) 호출에 사용. 미지정 시
   * `channelId.toString()` 으로 폴백.
   */
  channelIdentifier?: string;
  onScheduleClick?: (schedule: Schedule) => void;
  onEmptyClick?: (date: Date) => void;
  anniversaries?: CalendarAnniversary[];
  /** v2 통합 캘린더의 방송 기록 카드 클릭 핸들러. */
  onBroadcastClick?: (broadcast: CalendarBroadcastRecord) => void;
  /** Task 1.11 — 노래 클립 카드 클릭 시 클립 상세 페이지 이동. */
  onClipClick?: (clip: CalendarClipRecord) => void;
  /** 신규 채널 UI에서 월간 달력 6주 전체가 한 화면에 들어오도록 높이를 맞춘다. */
  fitCalendarToViewport?: boolean;
  manageHref?: string;
  notice?: ReactNode;
};

type CalendarViewMode = "week" | "month";

export function WeeklyScheduleViewer({
  channelId,
  channelIdentifier,
  onScheduleClick,
  onEmptyClick,
  anniversaries,
  onBroadcastClick,
  onClipClick,
  fitCalendarToViewport = false,
  manageHref,
  notice,
}: WeeklyScheduleViewerProps) {
  const isMobile = useIsMobile();
  const calendarV2Enabled = useChannelCalendarV2Flag();

  // v2 enabled 시 디폴트 월간. v1 은 기존 동작 (주간) 유지.
  //
  // SSR 직후엔 `useFeatureFlag` 가 default(false) 를 반환하므로 단순 useState
  // 초기값만으로는 PostHog 로드 후에도 week 에 머문다. 해결책으로 사용자
  // 명시 토글 (`userViewMode`) 과 flag 기반 default 를 분리:
  //   - userViewMode 가 set 되어 있으면 그것을 사용
  //   - 아니면 calendarV2Enabled ? "month" : "week"
  // 사용자가 토글 버튼을 누르는 순간 userViewMode 가 set 되어 그 시점부터
  // 사용자 선택을 우선 존중. setState-in-effect 패턴을 회피하면서도
  // PostHog 로드 후 자연스럽게 month 디폴트로 전환되는 효과.
  const [userViewMode, setUserViewMode] =
    useState<CalendarViewMode | null>(null);
  const viewMode: CalendarViewMode =
    userViewMode ?? (calendarV2Enabled ? "month" : "week");
  const setViewMode = (mode: CalendarViewMode) => setUserViewMode(mode);
  const [month, setMonth] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [weekStart, setWeekStartState] = useState<string>(() =>
    getWeekStart(new Date())
  );

  const weekTitle = useMemo(
    () => getWeekNumber(new Date(weekStart)),
    [weekStart]
  );
  const weekEnd = useMemo(() => getWeekEnd(new Date(weekStart)), [weekStart]);
  const monthTitle = useMemo(
    () =>
      month.toLocaleString("ko-KR", {
        year: "numeric",
        month: "long",
      }),
    [month]
  );
  const calendarTitle = viewMode === "week" ? weekTitle : monthTitle;

  const monthRange = useMemo(() => {
    const firstOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
    const startDay = firstOfMonth.getDay(); // 0 (Sun) ~ 6

    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(firstOfMonth.getDate() - startDay);
    gridStart.setHours(0, 0, 0, 0);

    const gridEnd = new Date(gridStart);
    gridEnd.setDate(gridStart.getDate() + 41);
    gridEnd.setHours(23, 59, 59, 999);

    return {
      from: gridStart.toISOString(),
      to: gridEnd.toISOString(),
      fromDate: gridStart,
      toDate: gridEnd,
    };
  }, [month]);

  // v1: 기존 useChannelSchedules 경로 (flag off)
  const weekSchedulesQuery = useChannelSchedules(
    channelId,
    { from: weekStart, to: weekEnd, limit: 500 },
    {
      enabled: !calendarV2Enabled && !!channelId && viewMode === "week",
      staleTime: 5 * 60 * 1000,
    }
  );

  const monthSchedulesQuery = useChannelSchedules(
    channelId,
    { from: monthRange.from, to: monthRange.to, limit: 500 },
    {
      enabled: !calendarV2Enabled && !!channelId && viewMode === "month",
      staleTime: 5 * 60 * 1000,
    }
  );

  // v2: 통합 캘린더 endpoint 경로 (flag on)
  const v2Identifier = channelIdentifier ?? (channelId ? String(channelId) : "");
  const weekRangeDates = useMemo(() => {
    const start = new Date(weekStart);
    const end = new Date(weekEnd);
    // 백엔드가 half-open `[from, to)` 이므로 weekEnd 다음 날을 to 로 보낸다.
    const toExclusive = new Date(end);
    toExclusive.setDate(toExclusive.getDate() + 1);
    return { from: start, to: toExclusive };
  }, [weekStart, weekEnd]);

  const weekCalendarQuery = useChannelCalendar(
    v2Identifier,
    weekRangeDates.from,
    weekRangeDates.to,
    {
      enabled: calendarV2Enabled && !!v2Identifier && viewMode === "week",
      staleTime: 5 * 60 * 1000,
    }
  );

  const monthCalendarQuery = useChannelCalendar(
    v2Identifier,
    monthRange.fromDate,
    // half-open `[from, to)` — gridEnd + 1ms 효과로 last day 포함.
    new Date(monthRange.toDate.getTime() + 1),
    {
      enabled: calendarV2Enabled && !!v2Identifier && viewMode === "month",
      staleTime: 5 * 60 * 1000,
    }
  );

  const activeCalendarQuery =
    viewMode === "week" ? weekCalendarQuery : monthCalendarQuery;
  const activeLegacyQuery =
    viewMode === "week" ? weekSchedulesQuery : monthSchedulesQuery;

  const schedules: Schedule[] = useMemo(() => {
    if (calendarV2Enabled) {
      return activeCalendarQuery.data?.schedules ?? [];
    }
    return activeLegacyQuery.data?.items ?? [];
  }, [
    calendarV2Enabled,
    activeCalendarQuery.data,
    activeLegacyQuery.data,
  ]);

  const broadcasts: CalendarBroadcastRecord[] = useMemo(() => {
    if (!calendarV2Enabled) return [];
    return activeCalendarQuery.data?.broadcasts ?? [];
  }, [calendarV2Enabled, activeCalendarQuery.data]);

  const clips: CalendarClipRecord[] = useMemo(() => {
    if (!calendarV2Enabled) return [];
    return activeCalendarQuery.data?.clips ?? [];
  }, [calendarV2Enabled, activeCalendarQuery.data]);

  const isLoading = calendarV2Enabled
    ? activeCalendarQuery.isLoading
    : activeLegacyQuery.isLoading;
  const isFetching = calendarV2Enabled
    ? activeCalendarQuery.isFetching
    : activeLegacyQuery.isFetching;
  const isGoogleMonth = fitCalendarToViewport && viewMode === "month";

  const handlePrevious = useCallback(() => {
    if (viewMode === "week") {
      setWeekStartState(getPreviousWeek(weekStart));
      return;
    }
    setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1));
  }, [month, viewMode, weekStart]);

  const handleNext = useCallback(() => {
    if (viewMode === "week") {
      setWeekStartState(getNextWeek(weekStart));
      return;
    }
    setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1));
  }, [month, viewMode, weekStart]);

  const handleToday = useCallback(() => {
    const now = new Date();
    if (viewMode === "week") {
      setWeekStartState(getWeekStart(now));
      return;
    }
    setMonth(new Date(now.getFullYear(), now.getMonth(), 1));
  }, [viewMode]);
  const handleDateSelect = useCallback((date: Date | undefined) => {
    if (!date) return;
    if (viewMode === "week") {
      setWeekStartState(getWeekStart(date));
    } else {
      setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    }
    setDatePickerOpen(false);
  }, [viewMode]);
  const handleViewModeChange = useCallback(
    (mode: CalendarViewMode) => {
      setViewMode(mode);
      if (mode === "month") {
        const anchor = new Date(weekStart);
        setMonth(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
      }
    },
    [weekStart]
  );

  useEffect(() => {
    if (!fitCalendarToViewport) return;
    return setChannelCalendarHeaderControls({
      title: calendarTitle,
      viewMode,
      isFetching,
      selectedDate: viewMode === "week" ? new Date(weekStart) : month,
      defaultMonth: viewMode === "week" ? new Date(weekStart) : month,
      manageHref,
      onToday: handleToday,
      onPrevious: handlePrevious,
      onNext: handleNext,
      onDateSelect: handleDateSelect,
      onViewModeChange: handleViewModeChange,
    });
  }, [
    calendarTitle,
    fitCalendarToViewport,
    handleDateSelect,
    handleNext,
    handlePrevious,
    handleToday,
    handleViewModeChange,
    isFetching,
    manageHref,
    month,
    viewMode,
    weekStart,
  ]);

  return (
    <div
      className={cn(
        "mb-8",
        isGoogleMonth &&
          "mb-0 flex h-full min-h-0 flex-col overflow-hidden"
      )}
    >
      {!fitCalendarToViewport && (
        <div className="z-10 mb-4 flex flex-col gap-4 border-b bg-background py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-1.5">
            <h1 className="text-lg font-semibold paperlogy">{calendarTitle}</h1>
            <Dialog>
              <DialogTrigger asChild>
                <button
                  type="button"
                  aria-label="캘린더 안내"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <HelpCircle className="h-4 w-4" />
                </button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle className="paperlogy">캘린더 안내</DialogTitle>
                  <DialogDescription className="sr-only">
                    채널 캘린더 페이지의 역할과 표시되는 데이터에 대한 설명
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>
                    이 페이지는 해당 채널의{" "}
                    <span className="font-semibold text-foreground">
                      방송 활동 통합 캘린더
                    </span>{" "}
                    입니다.
                  </p>
                  <p>
                    앞으로의 <strong>방송 일정</strong>부터 지난{" "}
                    <strong>방송 기록</strong>,{" "}
                    <strong>노래 클립</strong>, <strong>채널 기념일</strong> 등
                    방송과 관련된 모든 활동을 한 곳에서 모아 볼 수 있도록
                    설계되었습니다.
                  </p>
                  <ul className="space-y-1.5 pl-5 text-xs">
                    <li className="list-disc">
                      <span className="font-medium text-amber-600">기념일</span>{" "}
                      — 데뷔 100일 단위, 주년, 생일 등 자동 표시
                    </li>
                    <li className="list-disc">
                      <span className="font-medium text-slate-600">방송 기록</span>{" "}
                      — 실제로 송출됐던 방송 (제목/카테고리/시간)
                    </li>
                    <li className="list-disc">
                      <span className="font-medium text-blue-600">방송 일정</span>{" "}
                      — 채널 본인이 등록한 예정 일정
                    </li>
                  </ul>
                  <p className="text-xs">
                    날짜를 누르면 그 날의 모든 이벤트를 한눈에 볼 수 있습니다.
                  </p>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 self-end md:self-auto">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isFetching}
                className={cn(
                  "paperlogy",
                  viewMode === "week" && "bg-accent text-accent-foreground"
                )}
                onClick={() => handleViewModeChange("week")}
              >
                주간
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isFetching}
                className={cn(
                  "paperlogy",
                  viewMode === "month" && "bg-accent text-accent-foreground"
                )}
                onClick={() => handleViewModeChange("month")}
              >
                월간
              </Button>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={handleToday}
                className="paperlogy"
              >
                오늘
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handlePrevious}
                disabled={isFetching}
                aria-label={viewMode === "week" ? "이전 주" : "이전 달"}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleNext}
                disabled={isFetching}
                aria-label={viewMode === "week" ? "다음 주" : "다음 달"}
              >
                <ChevronRight className="size-4" />
              </Button>
              <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="날짜 선택">
                    <CalendarIcon className="size-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="single"
                    selected={viewMode === "week" ? new Date(weekStart) : month}
                    onSelect={handleDateSelect}
                    defaultMonth={
                      viewMode === "week" ? new Date(weekStart) : month
                    }
                  />
                </PopoverContent>
              </Popover>
              <CalendarSearchButton
                identifier={v2Identifier}
                onSelectDate={handleDateSelect}
                align="end"
              />
            </div>
          </div>
        </div>
      )}
      {fitCalendarToViewport && notice ? (
        <div className="shrink-0 bg-background">
          {notice}
        </div>
      ) : null}

      {(() => {
        if (isLoading) {
          if (viewMode === "month") {
            return (
              <div
                className={cn(
                  fitCalendarToViewport &&
                    "md:flex md:min-h-0 md:flex-1 md:flex-col"
                )}
              >
                <div className="grid grid-cols-7 text-sm text-muted-foreground font-medium md:shrink-0">
                  {["일", "월", "화", "수", "목", "금", "토"].map((w) => (
                    <div key={w} className="py-2 text-center select-none">
                      {w}
                    </div>
                  ))}
                </div>
                <div
                  className={cn(
                    "grid grid-cols-7 gap-px rounded-md overflow-hidden border border-gray-200 dark:border-gray-700 bg-border/40",
                    fitCalendarToViewport &&
                      "min-h-0 flex-1 grid-rows-[repeat(6,minmax(0,1fr))] rounded-none border-x-0 border-b-0"
                  )}
                >
                  {Array.from({ length: 42 }).map((_, idx) => (
                    <Skeleton
                      key={idx}
                      variant="muted"
                      className={cn(
                        "rounded-none",
                        fitCalendarToViewport
                          ? "h-full min-h-0"
                          : "min-h-28 sm:min-h-32 md:min-h-40 lg:min-h-48"
                      )}
                    />
                  ))}
                </div>
              </div>
            );
          }

          return isMobile ? (
            <MobileDaySelectorSkeleton />
          ) : (
            <DesktopWeeklyGridSkeleton />
          );
        }

        if (viewMode === "month") {
          return isMobile ? (
            <MobileMonthlyCalendar
              month={month}
              schedules={schedules}
              anniversaries={anniversaries ?? []}
              broadcasts={broadcasts}
              clips={clips}
              onScheduleClick={onScheduleClick}
              onAddSchedule={onEmptyClick}
              onBroadcastClick={onBroadcastClick}
              onClipClick={onClipClick}
              hideChannel={true}
              fitToViewport={fitCalendarToViewport}
            />
          ) : (
            <FavoriteMonthlyCalendar
              month={month}
              schedules={schedules}
              anniversaries={anniversaries ?? []}
              broadcasts={broadcasts}
              clips={clips}
              variant="channel"
              onScheduleClick={onScheduleClick}
              onAddSchedule={onEmptyClick}
              onBroadcastClick={onBroadcastClick}
              onClipClick={onClipClick}
              fitToViewport={fitCalendarToViewport}
            />
          );
        }

        return isMobile ? (
          <MobileWeeklyAgenda
            schedules={schedules}
            weekStart={weekStart}
            onScheduleClick={onScheduleClick}
            onEmptyClick={onEmptyClick}
            anniversaries={anniversaries}
            broadcasts={broadcasts}
            clips={clips}
            onBroadcastClick={onBroadcastClick}
            onClipClick={onClipClick}
            hideChannel={true}
          />
        ) : (
          <DesktopWeeklyGrid
            schedules={schedules}
            weekStart={weekStart}
            onScheduleClick={onScheduleClick}
            onEmptyClick={onEmptyClick}
            hideChannel={true}
            anniversaries={anniversaries}
            broadcasts={broadcasts}
            clips={clips}
            onBroadcastClick={onBroadcastClick}
            onClipClick={onClipClick}
          />
        );
      })()}
    </div>
  );
}
