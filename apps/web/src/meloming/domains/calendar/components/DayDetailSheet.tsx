"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/meloming/shared/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/meloming/shared/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/meloming/shared/components/ui/sheet";
import { Button } from "@/meloming/shared/components/ui/button";
import { useIsMobile } from "@/meloming/shared/hooks/use-mobile";
import type { Schedule } from "@/meloming/domains/schedule/types/schedule";
import type { CalendarAnniversary } from "@/meloming/domains/schedule/types/anniversary";
import type {
  CalendarBroadcastRecord,
  CalendarClipRecord,
  CalendarSetlistSummary,
} from "@/meloming/domains/calendar/types/channel-calendar";
import { BroadcastRecordCardMobile } from "@/meloming/domains/calendar/components/cards/BroadcastRecordCardMobile";
import { ClipRecordCardMobile } from "@/meloming/domains/calendar/components/cards/ClipRecordCardMobile";
import { SetlistRecordCardMobile } from "@/meloming/domains/calendar/components/cards/SetlistRecordCardMobile";
import { AnniversaryCardMobile } from "@/meloming/domains/schedule/components/weekly/AnniversaryCardMobile";
import { ScheduleCardMobile } from "@/meloming/domains/schedule/components/weekly/ScheduleCardMobile";
import { Clock, Film, Music, PartyPopper, Video } from "lucide-react";
import { cn } from "@/meloming/shared/lib/utils";

/**
 * Task 1.10 — 통합 캘린더 v2 의 일자 상세 시트.
 *
 * 모바일은 bottom sheet, 데스크톱은 모달 형태로 표시된다. 선택된 일자의
 * 5종 이벤트(기념일 / 셋리스트 / 방송 기록 / 노래 클립 / 일정)를 한 번에
 * 보여주며, 각 카드 클릭 시 외부 핸들러(onSetlistClick / onBroadcastClick /
 * onClipClick / onScheduleClick) 가 호출된다.
 */
export interface DayDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedDate: Date | null;
  anniversaries: CalendarAnniversary[];
  setlists: CalendarSetlistSummary[];
  broadcasts: CalendarBroadcastRecord[];
  /**
   * 노래 클립 목록. 빈 배열이면 섹션 미표시.
   */
  clips?: CalendarClipRecord[];
  schedules: Schedule[];
  /**
   * 즐겨찾기 캘린더에서 다른 채널의 일자를 열 때 사용. 미지정 시(채널 페이지 자체)
   * 채널 정보 표시는 생략한다.
   */
  channel?: {
    name: string;
    webPath: string;
    profileImageUrl?: string | null;
  };
  onScheduleClick?: (schedule: Schedule) => void;
  onAddSchedule?: (date: Date) => void;
  onSetlistClick?: (setlist: CalendarSetlistSummary) => void;
  onBroadcastClick?: (broadcast: CalendarBroadcastRecord) => void;
  onClipClick?: (clip: CalendarClipRecord) => void;
  /**
   * 시트 내부에서 채널 페이지로 직접 이동시키고 싶을 때만 true.
   * 즐겨찾기 캘린더 모달처럼 채널 헤더가 클릭되면 라우팅한다.
   */
  enableChannelLink?: boolean;
  /**
   * 일정 카드에서 채널 정보(아바타 + 이름)를 숨길지 여부.
   * 즐겨찾기 캘린더에선 false (채널 정보 표시), 단일 채널 페이지에선 true.
   */
  hideScheduleChannel?: boolean;
}

function formatHeaderDate(date: Date): string {
  return date.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

interface SectionProps {
  icon: React.ReactNode;
  title: string;
  count: number;
  children: React.ReactNode;
}

function Section({ icon, title, count, children }: SectionProps) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">({count})</span>
      </div>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}

interface DayDetailBodyProps
  extends Pick<
    DayDetailSheetProps,
    | "anniversaries"
    | "setlists"
    | "broadcasts"
    | "clips"
    | "schedules"
    | "onScheduleClick"
    | "onSetlistClick"
    | "onBroadcastClick"
    | "onClipClick"
    | "hideScheduleChannel"
  > {
  closeAndCall: <T,>(handler: ((arg: T) => void) | undefined, arg: T) => void;
}

function DayDetailBody({
  anniversaries,
  setlists,
  broadcasts,
  clips = [],
  schedules,
  onScheduleClick,
  onSetlistClick,
  onBroadcastClick,
  onClipClick,
  hideScheduleChannel,
  closeAndCall,
}: DayDetailBodyProps) {
  // 일정 정렬: 종일 → 시간순. spec 5.4 — setlist 위 broadcast 아래는 이미 prop 단위로 분리.
  const { allDay, timed } = useMemo(() => {
    const ad: Schedule[] = [];
    const td: Schedule[] = [];
    for (const s of schedules) {
      if (s.isCanceled) continue;
      if (s.allDay) ad.push(s);
      else td.push(s);
    }
    ad.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
    td.sort((a, b) => (a.startAt ?? "").localeCompare(b.startAt ?? ""));
    return { allDay: ad, timed: td };
  }, [schedules]);

  const hasAny =
    anniversaries.length +
      setlists.length +
      broadcasts.length +
      clips.length +
      allDay.length +
      timed.length >
    0;

  if (!hasAny) {
    return (
      <div
        data-testid="day-detail-empty"
        className="text-sm text-muted-foreground py-8 text-center"
      >
        이 날 이벤트가 없습니다.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {anniversaries.length > 0 && (
        <Section
          icon={<PartyPopper className="size-4 text-amber-500" />}
          title="기념일"
          count={anniversaries.length}
        >
          {anniversaries.map((ann) => (
            <li key={ann.id}>
              <AnniversaryCardMobile anniversary={ann} />
            </li>
          ))}
        </Section>
      )}

      {setlists.length > 0 && (
        <Section
          icon={<Music className="size-4 text-rose-500" />}
          title="노래 방송"
          count={setlists.length}
        >
          {setlists.map((sl) => (
            <li key={`setlist-${sl.sessionId}`}>
              <SetlistRecordCardMobile
                setlist={sl}
                onClick={
                  onSetlistClick
                    ? (s) => closeAndCall(onSetlistClick, s)
                    : undefined
                }
              />
            </li>
          ))}
        </Section>
      )}

      {broadcasts.length > 0 && (
        <Section
          icon={<Video className="size-4 text-slate-500" />}
          title="방송 기록"
          count={broadcasts.length}
        >
          {broadcasts.map((b) => (
            <li key={`broadcast-${b.sessionKey}`}>
              <BroadcastRecordCardMobile
                broadcast={b}
                onClick={
                  onBroadcastClick
                    ? (r) => closeAndCall(onBroadcastClick, r)
                    : undefined
                }
              />
            </li>
          ))}
        </Section>
      )}

      {clips.length > 0 && (
        <Section
          icon={<Film className="size-4 text-cyan-500" />}
          title="노래 클립"
          count={clips.length}
        >
          {clips.map((c) => (
            <li key={`clip-${c.id}`}>
              <ClipRecordCardMobile
                clip={c}
                onClick={
                  onClipClick
                    ? (clip) => closeAndCall(onClipClick, clip)
                    : undefined
                }
              />
            </li>
          ))}
        </Section>
      )}

      {allDay.length > 0 && (
        <Section
          icon={<Clock className="size-4 text-blue-500" />}
          title="종일 일정"
          count={allDay.length}
        >
          {allDay.map((s) => (
            <li key={`allday-${s.id}`}>
              <ScheduleCardMobile
                schedule={s}
                onClick={() => closeAndCall(onScheduleClick, s)}
                hideChannel={hideScheduleChannel}
              />
            </li>
          ))}
        </Section>
      )}

      {timed.length > 0 && (
        <Section
          icon={<Clock className="size-4 text-slate-500" />}
          title="시간 일정"
          count={timed.length}
        >
          {timed.map((s) => (
            <li key={`timed-${s.id}`}>
              <ScheduleCardMobile
                schedule={s}
                onClick={() => closeAndCall(onScheduleClick, s)}
                hideChannel={hideScheduleChannel}
              />
            </li>
          ))}
        </Section>
      )}
    </div>
  );
}

interface DayDetailHeaderProps {
  totalCount: number;
  channel?: DayDetailSheetProps["channel"];
  enableChannelLink?: boolean;
  onChannelClick?: () => void;
}

function DayDetailHeaderInner({
  totalCount,
  channel,
  enableChannelLink,
  onChannelClick,
}: DayDetailHeaderProps) {
  return (
    <>
      {channel && (
        <div className="flex items-center gap-2 text-sm">
          {enableChannelLink ? (
            <button
              type="button"
              data-testid="day-detail-channel-link"
              onClick={onChannelClick}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            >
              <Avatar className="size-6">
                <AvatarImage src={channel.profileImageUrl ?? undefined} />
                <AvatarFallback className="text-xs">
                  {channel.name.slice(0, 1)}
                </AvatarFallback>
              </Avatar>
              <span className="text-muted-foreground hover:underline">
                {channel.name}
              </span>
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <Avatar className="size-6">
                <AvatarImage src={channel.profileImageUrl ?? undefined} />
                <AvatarFallback className="text-xs">
                  {channel.name.slice(0, 1)}
                </AvatarFallback>
              </Avatar>
              <span className="text-muted-foreground">{channel.name}</span>
            </div>
          )}
        </div>
      )}
      <div
        data-testid="day-detail-event-count"
        className={cn(
          "text-xs text-muted-foreground",
          channel ? "mt-0.5" : ""
        )}
      >
        이벤트 {totalCount}건
      </div>
    </>
  );
}

export function DayDetailSheet({
  open,
  onOpenChange,
  selectedDate,
  anniversaries,
  setlists,
  broadcasts,
  clips = [],
  schedules,
  channel,
  onScheduleClick,
  onAddSchedule,
  onSetlistClick,
  onBroadcastClick,
  onClipClick,
  enableChannelLink,
  hideScheduleChannel,
}: DayDetailSheetProps) {
  const isMobile = useIsMobile();
  const router = useRouter();

  const totalCount =
    anniversaries.length +
    setlists.length +
    broadcasts.length +
    clips.length +
    schedules.filter((s) => !s.isCanceled).length;

  const handleChannelClick = () => {
    if (!channel?.webPath) return;
    onOpenChange(false);
    router.push(`/channel/${channel.webPath}`);
  };

  // 카드 클릭 시 시트를 자동으로 닫고 외부 핸들러로 컨트롤을 넘긴다.
  function closeAndCall<T>(
    handler: ((arg: T) => void) | undefined,
    arg: T
  ): void {
    if (!handler) return;
    onOpenChange(false);
    handler(arg);
  }

  const headerTitle = selectedDate
    ? formatHeaderDate(selectedDate)
    : "일자 상세";
  const handleAddSchedule = () => {
    if (!selectedDate || !onAddSchedule) return;
    onOpenChange(false);
    onAddSchedule(selectedDate);
  };

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          data-testid="day-detail-sheet"
          className="max-h-[85vh] overflow-y-auto"
        >
          <SheetHeader>
            <SheetTitle className="text-lg">{headerTitle}</SheetTitle>
            <SheetDescription className="sr-only">
              선택한 일자의 모든 이벤트입니다.
            </SheetDescription>
            <DayDetailHeaderInner
              totalCount={totalCount}
              channel={channel}
              enableChannelLink={enableChannelLink}
              onChannelClick={handleChannelClick}
            />
          </SheetHeader>
          <div className="px-4 pb-6">
            {selectedDate ? (
              <DayDetailBody
                anniversaries={anniversaries}
                setlists={setlists}
                broadcasts={broadcasts}
                clips={clips}
                schedules={schedules}
                onScheduleClick={onScheduleClick}
                onSetlistClick={onSetlistClick}
                onBroadcastClick={onBroadcastClick}
                onClipClick={onClipClick}
                hideScheduleChannel={hideScheduleChannel}
                closeAndCall={closeAndCall}
              />
            ) : null}
            {selectedDate && onAddSchedule ? (
              <Button className="mt-4 w-full" onClick={handleAddSchedule}>
                일정 추가
              </Button>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="day-detail-dialog"
        className="sm:max-w-[640px] max-h-[85vh] flex flex-col p-0 gap-0"
      >
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle className="text-lg">{headerTitle}</DialogTitle>
          <DialogDescription className="sr-only">
            선택한 일자의 모든 이벤트입니다.
          </DialogDescription>
          <DayDetailHeaderInner
            totalCount={totalCount}
            channel={channel}
            enableChannelLink={enableChannelLink}
            onChannelClick={handleChannelClick}
          />
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {selectedDate ? (
            <DayDetailBody
              anniversaries={anniversaries}
              setlists={setlists}
              broadcasts={broadcasts}
              clips={clips}
              schedules={schedules}
              onScheduleClick={onScheduleClick}
              onSetlistClick={onSetlistClick}
              onBroadcastClick={onBroadcastClick}
              onClipClick={onClipClick}
              closeAndCall={closeAndCall}
            />
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t px-6 pb-6 pt-2">
          {selectedDate && onAddSchedule ? (
            <Button onClick={handleAddSchedule}>일정 추가</Button>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            닫기
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
