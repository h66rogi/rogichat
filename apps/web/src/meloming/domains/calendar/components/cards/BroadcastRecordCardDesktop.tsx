"use client";

import type { CalendarBroadcastRecord } from "@/meloming/domains/calendar/types/channel-calendar";
import { Badge } from "@/meloming/shared/components/ui/badge";
import { Video } from "lucide-react";
import { cn } from "@/meloming/shared/lib/utils";

type BroadcastRecordCardDesktopProps = {
  broadcast: CalendarBroadcastRecord;
  onClick?: (broadcast: CalendarBroadcastRecord) => void;
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

const formatTimeRange = (broadcast: CalendarBroadcastRecord): string => {
  const start = formatTime(broadcast.startedAt);
  if (broadcast.status === "ACTIVE") {
    return start ? `${start} 이후` : "방송 중";
  }
  const end = formatTime(broadcast.endedAt);
  if (start && end) return `${start} - ${end}`;
  return start;
};

const PLATFORM_LABEL: Record<string, string> = {
  CHZZK: "치지직",
  SOOP: "숲",
  CIME: "씨미",
  YOUTUBE: "유튜브",
};

function platformLabel(platform: string | null | undefined): string {
  if (!platform) return "";
  return PLATFORM_LABEL[platform] ?? platform;
}

export function BroadcastRecordCardDesktop({
  broadcast,
  onClick,
}: BroadcastRecordCardDesktopProps) {
  const isActive = broadcast.status === "ACTIVE";
  const timeLabel = formatTimeRange(broadcast);
  const platform = platformLabel(broadcast.platform);

  const handleClick = () => onClick?.(broadcast);

  return (
    <div
      data-testid="broadcast-record-card-desktop"
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
        "bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-700",
        onClick && "cursor-pointer hover:shadow-md"
      )}
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <Video className="size-3.5" />
            <span className="tabular-nums">{timeLabel}</span>
          </div>
          {isActive ? (
            <Badge className="text-xs px-2 py-0.5 border-0 bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300 hidden xl:block">
              LIVE
            </Badge>
          ) : (
            <Badge className="text-xs px-2 py-0.5 border-0 bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200 hidden xl:block">
              방송 기록
            </Badge>
          )}
        </div>
        <h4 className="text-sm font-bold line-clamp-2 leading-snug group-hover:text-primary transition-colors">
          {broadcast.title || "제목 없음"}
        </h4>
        {broadcast.category && (
          <p className="text-xs text-muted-foreground line-clamp-1">
            {broadcast.category}
          </p>
        )}
        {platform && (
          <div className="flex items-center gap-2 pt-1 border-t border-border/50">
            <span className="text-xs text-muted-foreground font-medium truncate">
              {platform}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
