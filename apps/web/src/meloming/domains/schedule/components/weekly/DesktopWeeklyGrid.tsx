import { useMemo } from "react";
import type { Schedule } from "@/meloming/domains/schedule/types/schedule";
import type { CalendarAnniversary } from "@/meloming/domains/schedule/types/anniversary";
import type {
  CalendarBroadcastRecord,
  CalendarClipRecord,
} from "@/meloming/domains/calendar/types/channel-calendar";
import { ScheduleCardDesktop } from "./ScheduleCardDesktop";
import { AnniversaryCardDesktop } from "./AnniversaryCardDesktop";
import { BroadcastRecordCardDesktop } from "@/meloming/domains/calendar/components/cards/BroadcastRecordCardDesktop";
import { ClipRecordCardDesktop } from "@/meloming/domains/calendar/components/cards/ClipRecordCardDesktop";
import { Plus } from "lucide-react";
import { cn } from "@/meloming/shared/lib/utils";

type DesktopWeeklyGridProps = {
  schedules: Schedule[];
  weekStart: string; // yyyy-MM-dd
  onScheduleClick?: (schedule: Schedule) => void;
  onEmptyClick?: (date: Date) => void;
  hideChannel?: boolean;
  anniversaries?: CalendarAnniversary[];
  /** v2 통합 캘린더의 broadcast 기록. v1 경로에서는 빈 배열. */
  broadcasts?: CalendarBroadcastRecord[];
  /** v2 통합 캘린더의 노래 클립. v1 경로에서는 빈 배열. */
  clips?: CalendarClipRecord[];
  /** Task 1.10 에서 DayDetailSheet 와 연결될 클릭 핸들러. */
  onBroadcastClick?: (broadcast: CalendarBroadcastRecord) => void;
  /** Task 1.11 — 노래 클립 카드 클릭 핸들러. */
  onClipClick?: (clip: CalendarClipRecord) => void;
};

const parseDateKey = (s: string) => {
  // ISO 8601 형식도 파싱 가능하도록 Date 생성자 사용
  const date = new Date(s);
  // 로컬 날짜의 시작(00:00:00)으로 정규화
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

const toKey = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const isSameDay = (a: Date, b: Date) => startOfDay(a).getTime() === startOfDay(b).getTime();

const isToday = (d: Date) => isSameDay(d, new Date());

const getWeekDays = (isoStart: string) => {
  const start = startOfDay(parseDateKey(isoStart));
  const arr: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    arr.push(d);
  }
  return arr;
};

function groupByDateWithinWeek(schedules: Schedule[], isoStart: string) {
  const res: Record<string, Schedule[]> = {};
  const days = getWeekDays(isoStart);
  const start = days[0];
  const end = days[6];

  for (const s of schedules) {
    if (s.isCanceled) continue;
    const startAt = new Date(s.startAt);
    const endAt = s.allDay
      ? startOfDay(startAt)
      : s.endAt
      ? new Date(s.endAt)
      : startAt;

    // Range expansion, clamped to week
    const from = startOfDay(startAt < start ? start : startAt);
    const to = startOfDay(endAt > end ? end : endAt);
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const key = toKey(d);
      res[key] ||= [];
      res[key].push(s);
    }
  }

  // time sort per day
  Object.keys(res).forEach((k) => {
    res[k].sort((a, b) => {
      if (a.allDay && !b.allDay) return -1;
      if (!a.allDay && b.allDay) return 1;
      return (a.startAt ?? "").localeCompare(b.startAt ?? "");
    });
  });

  return res;
}

function groupAnniversariesByDate(
  anniversaries: CalendarAnniversary[],
  isoStart: string
) {
  const res: Record<string, CalendarAnniversary[]> = {};
  const days = getWeekDays(isoStart);
  const startDate = days[0];
  const endDate = days[6];

  for (const ann of anniversaries) {
    const annDate = startOfDay(new Date(ann.date));

    // 주간 범위 내에 있는 기념일만 표시
    if (annDate >= startDate && annDate <= endDate) {
      const key = toKey(annDate);
      res[key] ||= [];
      res[key].push(ann);
    }
  }

  return res;
}

function groupBroadcastsByDate(
  broadcasts: CalendarBroadcastRecord[],
  isoStart: string
) {
  const res: Record<string, CalendarBroadcastRecord[]> = {};
  const days = getWeekDays(isoStart);
  const startDate = days[0];
  const endDate = days[6];

  for (const b of broadcasts) {
    const start = new Date(b.startedAt);
    if (Number.isNaN(start.getTime())) continue;
    const day = startOfDay(start);
    if (day < startDate || day > endDate) continue;
    const key = toKey(day);
    res[key] ||= [];
    res[key].push(b);
  }

  Object.keys(res).forEach((k) => {
    res[k].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  });

  return res;
}

function groupClipsByDate(
  clips: CalendarClipRecord[],
  isoStart: string
) {
  const res: Record<string, CalendarClipRecord[]> = {};
  const days = getWeekDays(isoStart);
  const startDate = days[0];
  const endDate = days[6];

  for (const c of clips) {
    const start = new Date(c.createdAt);
    if (Number.isNaN(start.getTime())) continue;
    const day = startOfDay(start);
    if (day < startDate || day > endDate) continue;
    const key = toKey(day);
    res[key] ||= [];
    res[key].push(c);
  }

  Object.keys(res).forEach((k) => {
    res[k].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  });

  return res;
}

export function DesktopWeeklyGrid({
  schedules,
  weekStart,
  onScheduleClick,
  onEmptyClick,
  hideChannel = false,
  anniversaries = [],
  broadcasts = [],
  clips = [],
  onBroadcastClick,
  onClipClick,
}: DesktopWeeklyGridProps) {
  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStart]);
  const byDate = useMemo(() => groupByDateWithinWeek(schedules, weekStart), [schedules, weekStart]);
  const anniversariesByDate = useMemo(
    () => groupAnniversariesByDate(anniversaries, weekStart),
    [anniversaries, weekStart]
  );
  const broadcastsByDate = useMemo(
    () => groupBroadcastsByDate(broadcasts, weekStart),
    [broadcasts, weekStart]
  );
  const clipsByDate = useMemo(
    () => groupClipsByDate(clips, weekStart),
    [clips, weekStart]
  );

  return (
    <div className="grid grid-cols-7 gap-3">
      {weekDays.map((day) => {
        const key = toKey(day);
        const dayEvents = byDate[key] || [];
        const dayAnniversaries = anniversariesByDate[key] || [];
        const dayBroadcasts = broadcastsByDate[key] || [];
        const dayClips = clipsByDate[key] || [];
        const hasContent =
          dayEvents.length > 0 ||
          dayAnniversaries.length > 0 ||
          dayBroadcasts.length > 0 ||
          dayClips.length > 0;
        const isTodayDate = isToday(day);
        const dayOfWeek = day.getDay();
        const isSunday = dayOfWeek === 0;
        const isSaturday = dayOfWeek === 6;
        return (
          <div key={key} className="flex flex-col">
            <div
              className={cn(
                "text-center pb-2 border-b-2 mb-3 rounded-t-lg pt-2.5",
                isTodayDate
                  ? "bg-primary/10 border-primary"
                  : "border-border"
              )}
            >
              <div
                className={cn(
                  "text-sm font-semibold tracking-wider",
                  isTodayDate && "text-primary font-bold",
                  !isTodayDate && isSunday && "text-red-500/80 dark:text-red-400/80",
                  !isTodayDate && isSaturday && "text-blue-500/80 dark:text-blue-400/80"
                )}
              >
                {day.toLocaleDateString("ko-KR", { weekday: "short" })}
              </div>
              <div
                className={cn(
                  "text-base font-bold tabular-nums",
                  isTodayDate && "text-primary",
                  !isTodayDate && isSunday && "text-red-500 dark:text-red-400",
                  !isTodayDate && isSaturday && "text-blue-500 dark:text-blue-400",
                  !isTodayDate && !isSunday && !isSaturday && "text-foreground"
                )}
              >
                {day.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}
              </div>
            </div>
            <div className="space-y-2.5 flex-1">
              {/* 기념일 먼저 표시 */}
              {dayAnniversaries.map((ann) => (
                <AnniversaryCardDesktop key={ann.id} anniversary={ann} />
              ))}
              {/* anniversary → broadcast → clip → schedule — spec 5.4 + clip 확장 */}
              {dayBroadcasts.map((b) => (
                <BroadcastRecordCardDesktop
                  key={`${key}-broadcast-${b.sessionKey}`}
                  broadcast={b}
                  onClick={onBroadcastClick}
                />
              ))}
              {dayClips.map((c) => (
                <ClipRecordCardDesktop
                  key={`${key}-clip-${c.id}`}
                  clip={c}
                  onClick={onClipClick}
                />
              ))}
              {/* 일정 표시 */}
              {dayEvents.map((event) => (
                <ScheduleCardDesktop
                  key={`${event.id}-${key}`}
                  schedule={event}
                  onClick={() => onScheduleClick?.(event)}
                  hideChannel={hideChannel}
                />
              ))}
              {/* 콘텐츠가 없을 때 */}
              {!hasContent && (
                onEmptyClick ? (
                  <div
                    onClick={() => onEmptyClick(day)}
                    className={cn(
                      "border-2 border-dashed rounded-lg p-3 min-h-[80px] flex flex-col items-center justify-center gap-1 cursor-pointer transition-all",
                      "border-gray-200 dark:border-gray-700 hover:border-primary/50 hover:bg-primary/5",
                      "group"
                    )}
                  >
                    <Plus className="size-5 text-muted-foreground group-hover:text-primary transition-colors" />
                    <span className="text-xs text-muted-foreground group-hover:text-primary transition-colors">
                      일정 추가
                    </span>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-4">일정 없음</p>
                )
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}


