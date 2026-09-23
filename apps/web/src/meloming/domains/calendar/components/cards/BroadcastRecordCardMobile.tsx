"use client";

import type { CalendarBroadcastRecord } from "@/meloming/domains/calendar/types/channel-calendar";
import { Badge } from "@/meloming/shared/components/ui/badge";
import { Video } from "lucide-react";
import { cn } from "@/meloming/shared/lib/utils";

type BroadcastRecordCardMobileProps = {
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

export function BroadcastRecordCardMobile({
  broadcast,
  onClick,
}: BroadcastRecordCardMobileProps) {
  const isActive = broadcast.status === "ACTIVE";
  const timeLabel = formatTimeRange(broadcast);
  const platform = platformLabel(broadcast.platform);

  const handleClick = () => onClick?.(broadcast);

  return (
    <div
      data-testid="broadcast-record-card-mobile"
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
        "bg-slate-50 dark:bg-slate-900/40 border-l-slate-500",
        onClick && "cursor-pointer active:scale-[0.98]"
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <div className="flex items-center gap-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
              <Video className="size-3" />
              <span>{timeLabel}</span>
            </div>
            {isActive ? (
              <Badge className="text-[10px] px-1.5 py-0 h-5 border-0 bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">
                LIVE
              </Badge>
            ) : (
              <Badge className="text-[10px] px-1.5 py-0 h-5 border-0 bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                방송 기록
              </Badge>
            )}
            {platform && (
              <span className="text-[10px] text-muted-foreground">
                {platform}
              </span>
            )}
          </div>
          <p className="text-sm font-semibold mb-1 line-clamp-2 leading-snug">
            {broadcast.title || "제목 없음"}
          </p>
          {broadcast.category && (
            <p className="text-xs text-muted-foreground line-clamp-1">
              {broadcast.category}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
