"use client";

import { useMemo, useState } from "react";
import type { Schedule } from "@/meloming/domains/schedule/types/schedule";
import type { CalendarAnniversary } from "@/meloming/domains/schedule/types/anniversary";
import type {
  CalendarBroadcastRecord,
  CalendarClipRecord,
} from "@/meloming/domains/calendar/types/channel-calendar";
import { cn } from "@/meloming/shared/lib/utils";
import { ScheduleCardMobile } from "../weekly/ScheduleCardMobile";
import { AnniversaryCardMobile } from "../weekly/AnniversaryCardMobile";
import { BroadcastRecordCardMobile } from "@/meloming/domains/calendar/components/cards/BroadcastRecordCardMobile";
import { ClipRecordCardMobile } from "@/meloming/domains/calendar/components/cards/ClipRecordCardMobile";
import { DayDetailSheet } from "@/meloming/domains/calendar/components/DayDetailSheet";
import { CalendarIcon } from "lucide-react";

type MobileMonthlyCalendarProps = {
  month: Date;
  schedules: Schedule[];
  anniversaries: CalendarAnniversary[];
  /** v2 통합 캘린더의 broadcast 기록. v1 경로에서는 빈 배열. */
  broadcasts?: CalendarBroadcastRecord[];
  /** v2 통합 캘린더의 노래 클립. v1 경로에서는 빈 배열. */
  clips?: CalendarClipRecord[];
  onScheduleClick?: (schedule: Schedule) => void;
  onAddSchedule?: (date: Date) => void;
  /** Task 1.10 에서 DayDetailSheet 와 연결될 클릭 핸들러. */
  onBroadcastClick?: (broadcast: CalendarBroadcastRecord) => void;
  /** Task 1.11 — 노래 클립 카드 클릭 핸들러. */
  onClipClick?: (clip: CalendarClipRecord) => void;
  hideChannel?: boolean;
  /** 채널 신 UI에서 월간 그리드만 먼저 보이도록 상세 목록을 시트로 분리한다. */
  fitToViewport?: boolean;
};

const weekDayLabels = ["일", "월", "화", "수", "목", "금", "토"] as const;

const ymd = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};

const toStartOfDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());

const parseISOToDate = (s?: string): Date | undefined => {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

const isSameDay = (a: Date, b: Date) =>
  toStartOfDay(a).getTime() === toStartOfDay(b).getTime();

export function MobileMonthlyCalendar({
  month,
  schedules,
  anniversaries,
  broadcasts = [],
  clips = [],
  onScheduleClick,
  onAddSchedule,
  onBroadcastClick,
  onClipClick,
  hideChannel = false,
  fitToViewport = false,
}: MobileMonthlyCalendarProps) {
  // 사용자가 직접 선택한 날짜. 월이 바뀌면 아래 파생 selectedDate 가 자동으로
  // 현재 월 기본값을 사용하므로 effect 로 상태를 동기화하지 않는다.
  const [selectedDateOverride, setSelectedDateOverride] =
    useState<Date | null>(null);
  const [isDaySheetOpen, setIsDaySheetOpen] = useState(false);

  const defaultSelectedDate = useMemo(() => {
    const today = new Date();
    if (
      today.getMonth() === month.getMonth() &&
      today.getFullYear() === month.getFullYear()
    ) {
      return today;
    }
    return new Date(month.getFullYear(), month.getMonth(), 1);
  }, [month]);

  const selectedDate =
    selectedDateOverride?.getMonth() === month.getMonth() &&
    selectedDateOverride?.getFullYear() === month.getFullYear()
      ? selectedDateOverride
      : defaultSelectedDate;

  const calendarDays = useMemo(() => {
    const firstOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
    const startDay = firstOfMonth.getDay();

    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(firstOfMonth.getDate() - startDay);

    const days: Date[] = [];
    // 6주 고정 (42일)
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      days.push(d);
    }

    return days;
  }, [month]);

  // 날짜별 데이터 그룹화
  const dataByDay = useMemo(() => {
    const map = new Map<
      string,
      {
        schedules: Schedule[];
        anniversaries: CalendarAnniversary[];
        broadcasts: CalendarBroadcastRecord[];
        clips: CalendarClipRecord[];
      }
    >();

    const ensure = (key: string) => {
      if (!map.has(key))
        map.set(key, {
          schedules: [],
          anniversaries: [],
          broadcasts: [],
          clips: [],
        });
      return map.get(key)!;
    };

    for (const ann of anniversaries) {
      const date = parseISOToDate(ann.date);
      if (!date) continue;
      const key = ymd(toStartOfDay(date));
      ensure(key).anniversaries.push(ann);
    }

    for (const b of broadcasts) {
      const date = parseISOToDate(b.startedAt);
      if (!date) continue;
      const key = ymd(toStartOfDay(date));
      ensure(key).broadcasts.push(b);
    }

    for (const c of clips) {
      const date = parseISOToDate(c.createdAt);
      if (!date) continue;
      const key = ymd(toStartOfDay(date));
      ensure(key).clips.push(c);
    }

    for (const s of schedules) {
      if (s.isCanceled) continue;
      const start = parseISOToDate(s.startAt);
      if (!start) continue;

      // 여러 날짜에 걸치는 경우 (MobileDaySelector 로직 참조)
      const startAt = new Date(s.startAt);
      const endAt = s.allDay
        ? toStartOfDay(startAt)
        : s.endAt
        ? new Date(s.endAt)
        : startAt;

      const rangeStart = toStartOfDay(startAt);
      // 단순화를 위해 시작일 기준으로만 매핑하거나, 범위 전체를 매핑할 수 있음.
      // 여기서는 달력 그리드에 '점'을 찍어야 하므로 범위 전체에 대해 매핑하는게 좋음.
      // 하지만 성능상 이슈가 있을 수 있으니 일단 시작일 기준 + MobileDaySelector 로직처럼 범위 루프

      // 범위 루프 (최대 60일 제한 등 안전장치 필요)
      const loopStart = new Date(rangeStart);
      const loopEnd = toStartOfDay(endAt);

      // loopEnd가 loopStart보다 작으면 (데이터 오류 등) 보정
      if (loopEnd < loopStart) loopEnd.setTime(loopStart.getTime());

      for (
        let d = new Date(loopStart);
        d <= loopEnd;
        d.setDate(d.getDate() + 1)
      ) {
        const key = ymd(d);
        ensure(key).schedules.push(s);
      }
    }

    // 정렬
    for (const [, bucket] of map) {
      bucket.anniversaries.sort((a, b) => a.daysUntil - b.daysUntil);
      bucket.schedules.sort((a, b) =>
        (a.startAt || "").localeCompare(b.startAt || "")
      );
      bucket.broadcasts.sort((a, b) =>
        a.startedAt.localeCompare(b.startedAt)
      );
      bucket.clips.sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt)
      );
    }

    return map;
  }, [schedules, anniversaries, broadcasts, clips]);

  const selectedKey = ymd(selectedDate);
  const selectedData = dataByDay.get(selectedKey);
  const selectedSchedules = selectedData?.schedules ?? [];
  const selectedAnniversaries = selectedData?.anniversaries ?? [];
  const selectedBroadcasts = selectedData?.broadcasts ?? [];
  const selectedClips = selectedData?.clips ?? [];

  const handleDateClick = (date: Date) => {
    setSelectedDateOverride(date);
    if (fitToViewport) {
      setIsDaySheetOpen(true);
    }
  };

  const calendarGrid = (
    <div
      className={cn(
        "bg-background rounded-lg border shadow-sm overflow-hidden",
        fitToViewport && "flex min-h-0 flex-1 flex-col rounded-none border-x-0 border-b-0 shadow-none"
      )}
    >
      <div
        className={cn(
          "grid grid-cols-7 text-xs font-semibold border-b-2 border-border bg-muted/40 tracking-wider",
          fitToViewport && "shrink-0 border-y bg-background"
        )}
      >
        {weekDayLabels.map((w, i) => (
          <div
            key={w}
            className={cn(
              "py-2.5 text-center",
              fitToViewport && "py-2",
              i === 0 && "text-red-500/80 dark:text-red-400/80",
              i === 6 && "text-blue-500/80 dark:text-blue-400/80",
              i !== 0 && i !== 6 && "text-muted-foreground"
            )}
          >
            {w}
          </div>
        ))}
      </div>
      <div
        className={cn(
          "grid grid-cols-7 gap-px bg-border/40",
          fitToViewport && "min-h-0 flex-1 grid-rows-[repeat(6,minmax(0,1fr))]"
        )}
      >
        {calendarDays.map((d) => {
          const key = ymd(d);
          const data = dataByDay.get(key);
          const hasSchedules = (data?.schedules.length ?? 0) > 0;
          const hasAnniversaries = (data?.anniversaries.length ?? 0) > 0;
          const hasBroadcasts = (data?.broadcasts.length ?? 0) > 0;
          const hasClips = (data?.clips.length ?? 0) > 0;
          const isCurrentMonth = d.getMonth() === month.getMonth();
          const isSelected = isSameDay(d, selectedDate);
          const today = new Date();
          const isTodayDate = isSameDay(d, today);
          const dayOfWeek = d.getDay();
          const isSunday = dayOfWeek === 0;
          const isSaturday = dayOfWeek === 6;

          return (
            <button
              key={key}
              type="button"
              onClick={() => handleDateClick(d)}
              className={cn(
                "relative flex flex-col items-center bg-background transition-colors active:bg-accent/40",
                fitToViewport
                  ? "h-full min-h-0 justify-center gap-1 pt-0"
                  : "h-13 gap-1 pt-2 sm:h-15",
                isSelected &&
                  "bg-primary text-primary-foreground ring-2 ring-primary ring-inset z-10 active:bg-primary",
                !isSelected && isTodayDate && "bg-accent/40"
              )}
            >
              <span
                className={cn(
                  "text-sm w-7 h-7 flex items-center justify-center rounded-full z-10 tabular-nums font-semibold",
                  fitToViewport && "h-6 w-6 text-xs",
                  isSelected
                    ? "text-primary-foreground"
                    : isTodayDate
                    ? "bg-foreground/10 text-foreground ring-1 ring-foreground/30"
                    : !isCurrentMonth
                    ? isSunday
                      ? "text-red-500/30 dark:text-red-400/30"
                      : isSaturday
                      ? "text-blue-500/30 dark:text-blue-400/30"
                      : "text-muted-foreground/40"
                    : isSunday
                    ? "text-red-500 dark:text-red-400"
                    : isSaturday
                    ? "text-blue-500 dark:text-blue-400"
                    : "text-foreground"
                )}
              >
                {d.getDate()}
              </span>
              <div
                className="flex max-w-full gap-0.5 h-2 items-end overflow-hidden"
                data-testid={`calendar-dots-${key}`}
              >
                {hasAnniversaries && (
                  <div
                    data-testid="dot-anniversary"
                    className="w-2 h-2 shrink-0 rounded-full bg-amber-500"
                  />
                )}
                {hasBroadcasts && (
                  <div
                    data-testid="dot-broadcast"
                    className="w-2 h-2 shrink-0 rounded-full bg-slate-500"
                  />
                )}
                {hasClips && (
                  <div
                    data-testid="dot-clip"
                    className="w-2 h-2 shrink-0 rounded-full bg-cyan-500"
                  />
                )}
                {hasSchedules && (
                  <div
                    data-testid="dot-schedule"
                    className="w-2 h-2 shrink-0 rounded-full bg-blue-500"
                  />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className={cn("space-y-4", fitToViewport && "flex min-h-0 flex-1 flex-col space-y-0")}>
      {calendarGrid}

      {fitToViewport ? (
        <DayDetailSheet
          open={isDaySheetOpen}
          onOpenChange={setIsDaySheetOpen}
          selectedDate={selectedDate}
          anniversaries={selectedAnniversaries}
          broadcasts={selectedBroadcasts}
          clips={selectedClips}
          schedules={selectedSchedules}
          onScheduleClick={onScheduleClick}
          onAddSchedule={onAddSchedule}
          onBroadcastClick={onBroadcastClick}
          onClipClick={onClipClick}
          hideScheduleChannel={hideChannel}
        />
      ) : (
        <>

          {/* Selected Date Details */}
          <div className="space-y-3 min-h-[200px]">
        <div className="flex items-center gap-2 mb-2 px-1">
          <div
            className={cn(
              "text-lg font-bold tabular-nums",
              selectedDate.getDay() === 0 && "text-red-500 dark:text-red-400",
              selectedDate.getDay() === 6 && "text-blue-500 dark:text-blue-400"
            )}
          >
            {selectedDate.getDate()}일
          </div>
          <div className="text-sm text-muted-foreground">
            {selectedDate.toLocaleDateString("ko-KR", { weekday: "long" })}
          </div>
          <div className="flex-1 border-b ml-2" />
        </div>

        {selectedSchedules.length === 0 &&
        selectedAnniversaries.length === 0 &&
        selectedBroadcasts.length === 0 &&
        selectedClips.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">
            <CalendarIcon className="size-10 mx-auto mb-2 opacity-20" />
            <p className="text-sm">일정이 없습니다</p>
          </div>
        ) : (
          <>
            {selectedAnniversaries.map((ann) => (
              <AnniversaryCardMobile key={ann.id} anniversary={ann} />
            ))}
            {/* anniversary → broadcast → clip → schedule — spec 5.4 + clip 확장 */}
            {selectedBroadcasts.map((b) => (
              <BroadcastRecordCardMobile
                key={`broadcast-${b.sessionKey}`}
                broadcast={b}
                onClick={onBroadcastClick}
              />
            ))}
            {selectedClips.map((c) => (
              <ClipRecordCardMobile
                key={`clip-${c.id}`}
                clip={c}
                onClick={onClipClick}
              />
            ))}
            {selectedSchedules.map((s) => (
              <ScheduleCardMobile
                key={s.id}
                schedule={s}
                onClick={() => onScheduleClick?.(s)}
                hideChannel={hideChannel}
              />
            ))}
          </>
        )}
          </div>
        </>
      )}
    </div>
  );
}
