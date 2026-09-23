"use client";

import type { CalendarSetlistSummary } from "@/meloming/domains/calendar/types/channel-calendar";
import { Badge } from "@/meloming/shared/components/ui/badge";
import { Music } from "lucide-react";
import { cn } from "@/meloming/shared/lib/utils";

type SetlistRecordCardDesktopProps = {
  setlist: CalendarSetlistSummary;
  /** 표시할 albumArtPreview 최대 개수 (default 3 — 데스크톱 셀이 좁으므로). */
  maxThumbnails?: number;
  onClick?: (setlist: CalendarSetlistSummary) => void;
};

const formatTime = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

const formatTimeRange = (setlist: CalendarSetlistSummary): string => {
  const start = formatTime(setlist.startedAt);
  const end = formatTime(setlist.endedAt);
  if (!setlist.endedAt) {
    return start ? `${start} 이후` : "진행 중";
  }
  if (start && end) return `${start} - ${end}`;
  return start;
};

export function SetlistRecordCardDesktop({
  setlist,
  maxThumbnails,
  onClick,
}: SetlistRecordCardDesktopProps) {
  const timeLabel = formatTimeRange(setlist);
  const previews = setlist.albumArtPreviews ?? [];
  const limit = maxThumbnails ?? 3;
  const shown = previews.slice(0, limit);
  const overflow = Math.max(previews.length - shown.length, 0);

  const handleClick = () => onClick?.(setlist);

  return (
    <div
      data-testid="setlist-record-card-desktop"
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick ? handleClick : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleClick();
              }
            }
          : undefined
      }
      className={cn(
        "border rounded-lg p-3 transition-all group",
        "bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900",
        onClick && "cursor-pointer hover:shadow-md"
      )}
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 text-sm font-semibold text-rose-700 dark:text-rose-300">
            <Music className="size-3.5" />
            <span className="tabular-nums">{timeLabel}</span>
          </div>
          <Badge className="text-xs px-2 py-0.5 border-0 bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300 hidden xl:block">
            노래 방송
          </Badge>
        </div>
        <h4 className="text-sm font-bold leading-snug group-hover:text-primary transition-colors">
          {setlist.completedCount}곡
          {setlist.durationMinutes != null && (
            <span className="text-xs font-normal text-muted-foreground ml-1.5">
              · {setlist.durationMinutes}분
            </span>
          )}
        </h4>
        {shown.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap pt-1 border-t border-border/50">
            {shown.map((url, idx) => (
              // 24px 이하 외부 CDN 썸네일 — next/image 의 srcSet 변환은 과한 cost.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`${url}-${idx}`}
                src={url}
                alt=""
                loading="lazy"
                decoding="async"
                className="size-6 rounded object-cover bg-muted"
              />
            ))}
            {overflow > 0 && (
              <span className="text-[10px] text-muted-foreground ml-0.5">
                +{overflow}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
