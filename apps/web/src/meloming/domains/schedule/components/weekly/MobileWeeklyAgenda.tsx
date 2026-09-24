import { useState, useMemo, useRef, useEffect } from "react";
import type { Schedule } from "@/meloming/domains/schedule/types/schedule";
import type { CalendarAnniversary } from "@/meloming/domains/schedule/types/anniversary";
import type {
  CalendarBroadcastRecord,
  CalendarClipRecord,
} from "@/meloming/domains/calendar/types/channel-calendar";
import { cn } from "@/meloming/shared/lib/utils";
import { ScheduleCardMobile } from "./ScheduleCardMobile";
import { AnniversaryCardMobile } from "./AnniversaryCardMobile";
import { BroadcastRecordCardMobile } from "@/meloming/domains/calendar/components/cards/BroadcastRecordCardMobile";
import { ClipRecordCardMobile } from "@/meloming/domains/calendar/components/cards/ClipRecordCardMobile";
import { ChevronDown, ChevronUp, Plus } from "lucide-react";

type MobileWeeklyAgendaProps = {
  schedules: Schedule[];
  weekStart: string; // yyyy-MM-dd
  onScheduleClick?: (schedule: Schedule) => void;
  onEmptyClick?: (date: Date) => void;
  anniversaries?: CalendarAnniversary[];
  /** v2 통합 캘린더의 broadcast 기록. v1 경로에서는 빈 배열. */
  broadcasts?: CalendarBroadcastRecord[];
  /** v2 통합 캘린더의 노래 클립. v1 경로에서는 빈 배열. */
  clips?: CalendarClipRecord[];
  /** Task 1.10 에서 DayDetailSheet 와 연결될 클릭 핸들러. */
  onBroadcastClick?: (broadcast: CalendarBroadcastRecord) => void;
  /** Task 1.11 — 노래 클립 카드 클릭 핸들러. */
  onClipClick?: (clip: CalendarClipRecord) => void;
  hideChannel?: boolean;
};

const parseDateKey = (s: string) => {
  const date = new Date(s);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

const toKey = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};

const startOfDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());

const isSameDay = (a: Date, b: Date) =>
  startOfDay(a).getTime() === startOfDay(b).getTime();

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

    const from = startOfDay(startAt < start ? start : startAt);
    const to = startOfDay(endAt > end ? end : endAt);
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const key = toKey(d);
      res[key] ||= [];
      res[key].push(s);
    }
  }

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

export function MobileWeeklyAgenda({
  schedules,
  weekStart,
  onScheduleClick,
  onEmptyClick,
  anniversaries = [],
  broadcasts = [],
  clips = [],
  onBroadcastClick,
  onClipClick,
  hideChannel = false,
}: MobileWeeklyAgendaProps) {
  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStart]);
  const grouped = useMemo(
    () => groupByDateWithinWeek(schedules, weekStart),
    [schedules, weekStart]
  );
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

  // 날짜별 접힘 상태 관리 (true: 접힘, false: 펼침)
  const [collapsedStates, setCollapsedStates] = useState<
    Record<string, boolean>
  >({});

  const toggleDay = (dateKey: string) => {
    setCollapsedStates((prev) => ({
      ...prev,
      [dateKey]: !prev[dateKey],
    }));
  };

  // position:sticky chain 을 직접 시뮬레이션한다. 한 시점에 한 day header 만
  // position:fixed 로 stuck 처리하고, 나머지는 in-flow.
  // Radix Dialog 등의 react-remove-scroll 이 body 의 overflow/position 을 잠가
  // sticky containing block 이 viewport→body 로 재할당되면 모든 sticky day header
  // 가 scrollY 만큼 viewport 위로 튀어 사라지는 문제 회피.
  const containerRef = useRef<HTMLDivElement>(null);
  const groupRefs = useRef(new Map<string, HTMLDivElement>());
  const headerRefs = useRef(new Map<string, HTMLDivElement>());
  const [stuck, setStuck] = useState<{
    key: string;
    headerHeight: number;
    left: number;
    width: number;
  } | null>(null);

  useEffect(() => {
    const getStickyTop = () => {
      const scope = containerRef.current ?? document.body;
      return (
        parseFloat(
          getComputedStyle(scope).getPropertyValue(
            "--page-content-sticky-top",
          ),
        ) || 0
      );
    };

    const measure = () => {
      const stickyTop = getStickyTop();
      let next: typeof stuck = null;
      for (const [key, groupEl] of groupRefs.current) {
        const headerEl = headerRefs.current.get(key);
        if (!headerEl) continue;
        const groupRect = groupEl.getBoundingClientRect();
        const headerHeight = headerEl.getBoundingClientRect().height;
        // group top 이 sticky 라인 위로 올라갔고, group bottom 이 아직 header 높이만큼 아래에 있는 동안 stuck.
        if (
          groupRect.top <= stickyTop &&
          groupRect.bottom > stickyTop + headerHeight
        ) {
          next = {
            key,
            headerHeight,
            left: groupRect.left,
            width: groupRect.width,
          };
          break;
        }
      }
      setStuck((prev) => {
        if (!prev && !next) return prev;
        if (
          prev &&
          next &&
          prev.key === next.key &&
          prev.headerHeight === next.headerHeight &&
          prev.left === next.left &&
          prev.width === next.width
        ) {
          return prev;
        }
        return next;
      });
    };

    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure, { passive: true });
    return () => {
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, []);

  return (
    <div ref={containerRef} className="space-y-6 pb-10">
      {weekDays.map((day) => {
        const dateKey = toKey(day);
        const daySchedules = grouped[dateKey] || [];
        const dayAnniversaries = anniversariesByDate[dateKey] || [];
        const dayBroadcasts = broadcastsByDate[dateKey] || [];
        const dayClips = clipsByDate[dateKey] || [];
        const hasContent =
          daySchedules.length > 0 ||
          dayAnniversaries.length > 0 ||
          dayBroadcasts.length > 0 ||
          dayClips.length > 0;
        const isTodayDate = isToday(day);

        // 과거 날짜인지 확인 (오늘 기준 이전 날짜)
        const isPastDay = startOfDay(day) < startOfDay(new Date());

        // 상태가 있으면 그 상태를 따르고, 없으면 과거 날짜인 경우 접힌 상태(true)가 기본값
        const isCollapsed = collapsedStates[dateKey] ?? isPastDay;

        const isStuckHere = stuck?.key === dateKey;

        return (
          <div
            key={dateKey}
            ref={(el) => {
              if (el) groupRefs.current.set(dateKey, el);
              else groupRefs.current.delete(dateKey);
            }}
            className="flex flex-col gap-2"
          >
            {/* Day Header — stuck 시점엔 fixed + placeholder 로 in-flow 자리 유지 */}
            {isStuckHere && (
              <div aria-hidden style={{ height: stuck!.headerHeight }} />
            )}
            <div
              ref={(el) => {
                if (el) headerRefs.current.set(dateKey, el);
                else headerRefs.current.delete(dateKey);
              }}
              onClick={() => toggleDay(dateKey)}
              className={cn(
                "z-10 bg-background/95 backdrop-blur-sm py-2 px-1 border-b flex items-center justify-between cursor-pointer active:bg-accent/50 transition-colors",
                isStuckHere && "fixed top-[var(--page-content-sticky-top)]",
                isTodayDate
                  ? "text-primary border-primary"
                  : "text-muted-foreground"
              )}
              style={
                isStuckHere
                  ? { left: `${stuck!.left}px`, width: `${stuck!.width}px` }
                  : undefined
              }
            >
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold">{day.getDate()}</span>
                <span className="text-sm font-medium">
                  {day.toLocaleDateString("ko-KR", { weekday: "long" })}
                </span>
                {isTodayDate && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-bold">
                    Today
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="text-xs opacity-70">
                  {(() => {
                    const total =
                      daySchedules.length +
                      dayAnniversaries.length +
                      dayBroadcasts.length +
                      dayClips.length;
                    return total > 0 ? `${total}건` : null;
                  })()}
                </div>
                {isCollapsed ? (
                  <ChevronDown className="size-4 opacity-50" />
                ) : (
                  <ChevronUp className="size-4 opacity-50" />
                )}
              </div>
            </div>

            {/* Content List */}
            {!isCollapsed && (
              <div className="pl-2 space-y-3 animate-in slide-in-from-top-2 duration-200">
                {hasContent ? (
                  <>
                    {dayAnniversaries.map((ann) => (
                      <AnniversaryCardMobile key={ann.id} anniversary={ann} />
                    ))}
                    {/* anniversary → broadcast → clip → schedule — spec 5.4 + clip 확장 */}
                    {dayBroadcasts.map((b) => (
                      <BroadcastRecordCardMobile
                        key={`broadcast-${b.sessionKey}`}
                        broadcast={b}
                        onClick={onBroadcastClick}
                      />
                    ))}
                    {dayClips.map((c) => (
                      <ClipRecordCardMobile
                        key={`clip-${c.id}`}
                        clip={c}
                        onClick={onClipClick}
                      />
                    ))}
                    {daySchedules.map((s) => (
                      <ScheduleCardMobile
                        key={s.id}
                        schedule={s}
                        onClick={() => onScheduleClick?.(s)}
                        hideChannel={hideChannel}
                      />
                    ))}
                  </>
                ) : onEmptyClick ? (
                  <div
                    onClick={() => onEmptyClick(day)}
                    className={cn(
                      "border-2 border-dashed rounded-lg p-4 flex items-center justify-center gap-2 cursor-pointer transition-all",
                      "border-gray-200 dark:border-gray-700 hover:border-primary/50 hover:bg-primary/5 active:bg-primary/10",
                      "group"
                    )}
                  >
                    <Plus className="size-5 text-muted-foreground group-hover:text-primary transition-colors" />
                    <span className="text-sm text-muted-foreground group-hover:text-primary transition-colors">
                      일정 추가
                    </span>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground/40 py-2 pl-1">
                    일정이 없습니다
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
