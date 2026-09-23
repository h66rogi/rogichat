"use client";

import type { CalendarSetlistSummary } from "@/meloming/domains/calendar/types/channel-calendar";
import { Badge } from "@/meloming/shared/components/ui/badge";
import { Music } from "lucide-react";
import { cn } from "@/meloming/shared/lib/utils";

type SetlistRecordCardMobileProps = {
  setlist: CalendarSetlistSummary;
  /** 표시할 albumArtPreview 최대 개수 (default 6 — 모바일은 셀이 넓으므로). */
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

export function SetlistRecordCardMobile({
  setlist,
  maxThumbnails,
  onClick,
}: SetlistRecordCardMobileProps) {
  const isActive = !setlist.endedAt;
  const timeLabel = formatTimeRange(setlist);
  const previews = setlist.albumArtPreviews ?? [];
  const limit = maxThumbnails ?? 6;
  const shown = previews.slice(0, limit);
  const overflow = Math.max(previews.length - shown.length, 0);

  const handleClick = () => onClick?.(setlist);

  return (
    <div
      data-testid="setlist-record-card-mobile"
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
        "border-l-4 rounded-md p-3 transition-transform",
        "bg-rose-50 dark:bg-rose-950/30 border-l-rose-500",
        onClick && "cursor-pointer active:scale-[0.98]"
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <div className="flex items-center gap-1 text-xs font-semibold text-rose-700 dark:text-rose-300">
              <Music className="size-3" />
              <span>{timeLabel}</span>
            </div>
            <Badge className="text-[10px] px-1.5 py-0 h-5 border-0 bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300">
              {isActive ? "노래 방송 (진행 중)" : "노래 방송"}
            </Badge>
          </div>
          <p className="text-sm font-semibold mb-2 line-clamp-2 leading-snug">
            {setlist.completedCount}곡
            {setlist.durationMinutes != null && (
              <span className="text-xs font-normal text-muted-foreground ml-1.5">
                · {setlist.durationMinutes}분
              </span>
            )}
          </p>
          {shown.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              {shown.map((url, idx) => (
                // 32px 이하 외부 CDN 썸네일 — next/image 의 srcSet 변환은 과한 cost.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={`${url}-${idx}`}
                  src={url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="size-8 rounded object-cover bg-muted"
                />
              ))}
              {overflow > 0 && (
                <span className="text-[11px] text-muted-foreground ml-1">
                  +{overflow}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
