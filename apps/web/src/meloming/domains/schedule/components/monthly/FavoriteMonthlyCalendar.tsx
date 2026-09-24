"use client";

import { useMemo, useState } from "react";
import type { Schedule } from "@/meloming/domains/schedule/types/schedule";
import type { CalendarAnniversary } from "@/meloming/domains/schedule/types/anniversary";
import type {
  CalendarBroadcastRecord,
  CalendarClipRecord,
} from "@/meloming/domains/calendar/types/channel-calendar";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/meloming/shared/components/ui/avatar";
import { cn } from "@/meloming/shared/lib/utils";
import { Cake, Film, PartyPopper, Video } from "lucide-react";
import { DayDetailSheet } from "@/meloming/domains/calendar/components/DayDetailSheet";
import { AvatarPlaceholder } from "@/shared/ui/avatar-placeholder";

type MonthlyCalendarVariant = "favorites" | "channel";

type FavoriteMonthlyCalendarProps = {
  month: Date;
  schedules: Schedule[];
  anniversaries: CalendarAnniversary[];
  /** v2 통합 캘린더의 broadcast 기록. v1 경로에서는 빈 배열. */
  broadcasts?: CalendarBroadcastRecord[];
  /** v2 통합 캘린더의 노래 클립. v1 경로에서는 빈 배열. */
  clips?: CalendarClipRecord[];
  variant?: MonthlyCalendarVariant;
  onScheduleClick?: (schedule: Schedule) => void;
  onAddSchedule?: (date: Date) => void;
  /** Task 1.10 에서 DayDetailSheet 와 연결될 클릭 핸들러. */
  onBroadcastClick?: (broadcast: CalendarBroadcastRecord) => void;
  /** Task 1.11 — 노래 클립 카드 클릭 핸들러. */
  onClipClick?: (clip: CalendarClipRecord) => void;
  /** 채널 신 UI에서 6주 그리드를 뷰포트 안에 맞추는 압축 레이아웃. */
  fitToViewport?: boolean;
};

type DayBucket = {
  anniversaries: CalendarAnniversary[];
  broadcasts: CalendarBroadcastRecord[];
  clips: CalendarClipRecord[];
  allDay: Schedule[];
  timed: Schedule[];
};

type MonthlyItem =
  | { kind: "anniversary"; anniversary: CalendarAnniversary }
  | { kind: "broadcast"; broadcast: CalendarBroadcastRecord }
  | { kind: "clip"; clip: CalendarClipRecord }
  | { kind: "schedule"; schedule: Schedule; isAllDay: boolean };

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

const formatTime = (dateStr: string) => {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

function buildScheduleAvatar(schedule: Schedule): {
  imageUrl?: string;
  fallbackText: string;
} {
  const channelName = schedule.channel?.name;
  const authorName = schedule.author?.nickname;
  const fallbackText = (channelName ?? authorName ?? "?").slice(0, 1);

  const url =
    schedule.channel?.profileImageUrl ??
    schedule.author?.profileImageUrl ??
    null;

  return {
    imageUrl: url ?? undefined,
    fallbackText,
  };
}

function buildAnniversaryAvatar(ann: CalendarAnniversary): {
  imageUrl?: string;
  fallbackText: string;
} {
  return {
    imageUrl: ann.profileImageUrl ?? undefined,
    fallbackText: ann.channelName.slice(0, 1),
  };
}

export function FavoriteMonthlyCalendar({
  month,
  schedules,
  anniversaries,
  broadcasts = [],
  clips = [],
  variant = "favorites",
  onScheduleClick,
  onAddSchedule,
  onBroadcastClick,
  onClipClick,
  fitToViewport = false,
}: FavoriteMonthlyCalendarProps) {
  const [isDayModalOpen, setIsDayModalOpen] = useState(false);
  const [modalDate, setModalDate] = useState<Date | null>(null);

  const calendarDays = useMemo(() => {
    const firstOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
    const startDay = firstOfMonth.getDay();

    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(firstOfMonth.getDate() - startDay);

    const days: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      days.push(d);
    }

    return days;
  }, [month]);

  const bucketsByDay = useMemo(() => {
    const map = new Map<string, DayBucket>();

    const ensure = (key: string) => {
      const existing = map.get(key);
      if (existing) return existing;
      const next: DayBucket = {
        anniversaries: [],
        broadcasts: [],
        clips: [],
        allDay: [],
        timed: [],
      };
      map.set(key, next);
      return next;
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
      const key = ymd(toStartOfDay(start));
      const bucket = ensure(key);
      if (s.allDay) bucket.allDay.push(s);
      else bucket.timed.push(s);
    }

    for (const [, bucket] of map) {
      bucket.anniversaries.sort((a, b) => {
        if (a.type !== b.type) return a.type === "birthday" ? -1 : 1;
        return a.daysUntil - b.daysUntil;
      });

      bucket.broadcasts.sort((a, b) =>
        a.startedAt.localeCompare(b.startedAt)
      );
      bucket.clips.sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt)
      );

      bucket.allDay.sort((a, b) =>
        (a.title ?? "").localeCompare(b.title ?? "")
      );

      bucket.timed.sort((a, b) => {
        const at = a.startAt ?? "";
        const bt = b.startAt ?? "";
        return at.localeCompare(bt);
      });
    }

    return map;
  }, [anniversaries, schedules, broadcasts, clips]);

  const openDayModal = (d: Date) => {
    setModalDate(d);
    setIsDayModalOpen(true);
  };

  const renderCellItems = (date: Date) => {
    const key = ymd(date);
    const bucket = bucketsByDay.get(key);

    const items: MonthlyItem[] = [
      ...(bucket?.anniversaries ?? []).map((a) => ({
        kind: "anniversary" as const,
        anniversary: a,
      })),
      ...(bucket?.broadcasts ?? []).map((b) => ({
        kind: "broadcast" as const,
        broadcast: b,
      })),
      ...(bucket?.clips ?? []).map((c) => ({
        kind: "clip" as const,
        clip: c,
      })),
      ...(bucket?.allDay ?? []).map((s) => ({
        kind: "schedule" as const,
        schedule: s,
        isAllDay: true,
      })),
      ...(bucket?.timed ?? []).map((s) => ({
        kind: "schedule" as const,
        schedule: s,
        isAllDay: false,
      })),
    ];

    if (items.length === 0) return null;

    const MAX_SHOWN = fitToViewport ? 3 : 4;
    const shown = items.slice(0, MAX_SHOWN);
    const remaining = items.length - shown.length;

    return (
      <>
        <ul className={cn("mt-1 space-y-1", fitToViewport && "space-y-0.5")}>
          {shown.map((item, idx) => {
            if (item.kind === "anniversary") {
              const Icon =
                item.anniversary.type === "birthday" ? Cake : PartyPopper;
              const avatar = buildAnniversaryAvatar(item.anniversary);
              const ddayLabel =
                item.anniversary.daysUntil === 0
                  ? "D-DAY"
                  : `D-${item.anniversary.daysUntil}`;

              return (
                <li key={`${key}-ann-${item.anniversary.id}-${idx}`}>
                  <div
                    className={cn(
                      "w-full flex items-center gap-1.5 rounded px-1.5 py-1 text-xs",
                      fitToViewport && "h-5 py-0 text-[11px] font-medium",
                      "bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200"
                    )}
                    title={`${ddayLabel} ${item.anniversary.channelName} ${item.anniversary.label}`}
                  >
                    {variant === "favorites" ? (
                      <>
                        <Avatar className="size-4">
                          <AvatarImage src={avatar.imageUrl} />
                          <AvatarFallback className="text-[10px]">
                            <AvatarPlaceholder />
                          </AvatarFallback>
                        </Avatar>
                        <Icon
                          className={cn(
                            "size-3.5 shrink-0",
                            fitToViewport && "size-3"
                          )}
                        />
                      </>
                    ) : (
                      <Icon
                        className={cn(
                          "size-3.5 shrink-0",
                          fitToViewport && "size-3"
                        )}
                      />
                    )}
                    <span className="line-clamp-1 flex-1">
                      {item.anniversary.label}
                    </span>
                    {variant === "channel" && (
                      <span className="text-[10px] text-amber-700/80 dark:text-amber-200/70 shrink-0">
                        {ddayLabel}
                      </span>
                    )}
                  </div>
                </li>
              );
            }

            if (item.kind === "broadcast") {
              const broadcast = item.broadcast;
              const isActive = broadcast.status === "ACTIVE";
              return (
                <li key={`${key}-broadcast-${broadcast.sessionKey}-${idx}`}>
                  <button
                    type="button"
                    className={cn(
                      "w-full flex items-center gap-1.5 rounded px-1.5 py-1 text-xs text-left",
                      "hover:bg-accent/40",
                      fitToViewport && "h-5 py-0 text-[11px] font-medium",
                      "bg-slate-100 text-slate-800 dark:bg-slate-800/40 dark:text-slate-200"
                    )}
                    title={broadcast.title || "방송 기록"}
                    onClick={(e) => {
                      e.stopPropagation();
                      onBroadcastClick?.(broadcast);
                    }}
                  >
                    <Video
                      className={cn(
                        "size-3.5 shrink-0",
                        fitToViewport && "size-3"
                      )}
                    />
                    <span className="shrink-0 text-[10px] tabular-nums">
                      {formatTime(broadcast.startedAt)}
                    </span>
                    <span className="line-clamp-1 flex-1">
                      {isActive
                        ? "LIVE"
                        : broadcast.title || "방송 기록"}
                    </span>
                  </button>
                </li>
              );
            }

            if (item.kind === "clip") {
              const clip = item.clip;
              return (
                <li key={`${key}-clip-${clip.id}-${idx}`}>
                  <button
                    type="button"
                    data-testid="monthly-clip-cell"
                    className={cn(
                      "w-full flex items-center gap-1.5 rounded px-1.5 py-1 text-xs text-left",
                      "hover:bg-accent/40",
                      fitToViewport && "h-5 py-0 text-[11px] font-medium",
                      "bg-cyan-50 text-cyan-900 dark:bg-cyan-900/20 dark:text-cyan-200"
                    )}
                    title={clip.title || "노래 클립"}
                    onClick={(e) => {
                      e.stopPropagation();
                      onClipClick?.(clip);
                    }}
                  >
                    <Film
                      className={cn(
                        "size-3.5 shrink-0",
                        fitToViewport && "size-3"
                      )}
                    />
                    <span className="shrink-0 text-[10px] tabular-nums">
                      {formatTime(clip.createdAt)}
                    </span>
                    <span className="line-clamp-1 flex-1">
                      {clip.title || "노래 클립"}
                    </span>
                  </button>
                </li>
              );
            }

            const schedule = item.schedule;
            const avatar = buildScheduleAvatar(schedule);
            const title = schedule.content
              ? `${schedule.title}\n${schedule.content}`
              : schedule.title;

            return (
              <li key={`${key}-sch-${schedule.id}-${idx}`}>
                <button
                  type="button"
                  className={cn(
                    "w-full flex items-center gap-1.5 rounded px-1.5 py-1 text-xs text-left",
                    "hover:underline hover:bg-accent/40",
                    fitToViewport && "h-5 py-0 text-[11px]",
                    item.isAllDay
                      ? "bg-blue-50 text-blue-900 dark:bg-blue-900/20 dark:text-blue-200"
                      : "bg-transparent"
                  )}
                  title={title}
                  onClick={(e) => {
                    e.stopPropagation();
                    onScheduleClick?.(schedule);
                  }}
                >
                  {variant === "favorites" && (
                    <Avatar className="size-4">
                      <AvatarImage src={avatar.imageUrl} />
                      <AvatarFallback className="text-[10px]">
                        <AvatarPlaceholder />
                      </AvatarFallback>
                    </Avatar>
                  )}
                  <span
                    className={cn(
                      "shrink-0 tabular-nums",
                      item.isAllDay
                        ? "text-[10px]"
                        : "text-[10px] text-muted-foreground"
                    )}
                  >
                    {item.isAllDay ? "종일" : formatTime(schedule.startAt)}
                  </span>
                  <span className="line-clamp-1 flex-1">{schedule.title}</span>
                </button>
              </li>
            );
          })}

          {remaining > 0 && (
            <li>
              <button
                type="button"
                className={cn(
                  "px-1.5 text-[11px] text-muted-foreground underline hover:text-foreground",
                  fitToViewport && "h-5 leading-5 no-underline"
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  openDayModal(date);
                }}
              >
                +{remaining} 더 보기
              </button>
            </li>
          )}
        </ul>
      </>
    );
  };

  const modalBucket = modalDate
    ? bucketsByDay.get(ymd(modalDate))
    : undefined;

  // DayDetailSheet 가 받는 평탄한 schedules 배열 (allDay + timed 합본).
  const modalSchedules = useMemo<Schedule[]>(() => {
    if (!modalBucket) return [];
    return [...modalBucket.allDay, ...modalBucket.timed];
  }, [modalBucket]);

  return (
    <div className={cn(fitToViewport && "flex min-h-0 flex-1 flex-col")}>
      <div
        className={cn(
          "grid grid-cols-7 text-sm font-semibold border-b-2 border-border md:shrink-0",
          fitToViewport &&
            "shrink-0 border-y bg-background text-xs font-medium uppercase"
        )}
      >
        {weekDayLabels.map((w, i) => (
          <div
            key={w}
            className={cn(
              "py-2.5 text-center select-none tracking-wider",
              fitToViewport && "py-2 tracking-normal",
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
          "grid grid-cols-7 gap-px rounded-md overflow-hidden border border-border bg-border/60",
          fitToViewport &&
            "min-h-0 flex-1 grid-rows-[repeat(6,minmax(0,1fr))] rounded-none border-x-0 border-b-0"
        )}
      >
        {calendarDays.map((d) => {
          const key = ymd(d);
          const bucket = bucketsByDay.get(key);
          const count =
            (bucket?.anniversaries.length ?? 0) +
            (bucket?.broadcasts.length ?? 0) +
            (bucket?.clips.length ?? 0) +
            (bucket?.allDay.length ?? 0) +
            (bucket?.timed.length ?? 0);

          const isCurrentMonth = d.getMonth() === month.getMonth();
          const today = new Date();
          const isToday = isSameDay(d, today);
          const dayOfWeek = d.getDay();
          const isSunday = dayOfWeek === 0;
          const isSaturday = dayOfWeek === 6;

          return (
            <div
              key={key}
              role="button"
              tabIndex={0}
              onClick={() => openDayModal(d)}
              onKeyDown={(e) =>
                (e.key === "Enter" || e.key === " ") && openDayModal(d)
              }
              className={cn(
                "group/day-cell flex flex-col bg-background cursor-pointer transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                fitToViewport
                  ? "h-full min-h-0 overflow-hidden p-1.5 sm:p-2"
                  : "min-h-28 p-2 sm:min-h-32 md:min-h-40 lg:min-h-48",
                isToday && "ring-2 ring-primary/40 ring-inset hover:ring-0",
                !isCurrentMonth && "bg-muted/30"
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "text-base font-semibold tabular-nums inline-flex items-center justify-center",
                    fitToViewport && "h-6 min-w-6 text-sm font-medium",
                    isToday &&
                      "bg-primary text-primary-foreground rounded-full text-sm group-hover/day-cell:bg-transparent group-hover/day-cell:text-foreground",
                    isToday && (fitToViewport ? "size-6" : "size-7"),
                    !isToday &&
                      isCurrentMonth &&
                      isSunday &&
                      "text-red-500 dark:text-red-400",
                    !isToday &&
                      isCurrentMonth &&
                      isSaturday &&
                      "text-blue-500 dark:text-blue-400",
                    !isCurrentMonth && "text-muted-foreground/40"
                  )}
                >
                  {d.getDate()}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  {count > 0 && (
                    <span className="text-xs px-1.5 rounded bg-muted/80 text-muted-foreground tabular-nums font-medium">
                      {count}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-hidden">
                <div className="sm:hidden">
                  {count > 0 && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      일정 {count}건
                    </div>
                  )}
                </div>
                <div className="hidden sm:block">{renderCellItems(d)}</div>
              </div>
            </div>
          );
        })}
      </div>

      <DayDetailSheet
        open={isDayModalOpen}
        onOpenChange={setIsDayModalOpen}
        selectedDate={modalDate}
        anniversaries={modalBucket?.anniversaries ?? []}
        broadcasts={modalBucket?.broadcasts ?? []}
        clips={modalBucket?.clips ?? []}
        schedules={modalSchedules}
        onScheduleClick={onScheduleClick}
        onAddSchedule={onAddSchedule}
        onBroadcastClick={onBroadcastClick}
        onClipClick={onClipClick}
        // favorites variant 은 일정 카드에 채널 아바타 + 이름을 노출.
        hideScheduleChannel={variant === "channel"}
      />
    </div>
  );
}
