"use client";

import type { CalendarClipRecord } from "@/meloming/domains/calendar/types/channel-calendar";
import { Badge } from "@/meloming/shared/components/ui/badge";
import { Film } from "lucide-react";
import { cn } from "@/meloming/shared/lib/utils";

type ClipRecordCardDesktopProps = {
  clip: CalendarClipRecord;
  onClick?: (clip: CalendarClipRecord) => void;
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

const formatDuration = (seconds: number | null): string => {
  if (seconds == null || seconds < 0) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  }
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
};

const PLATFORM_LABEL: Record<string, string> = {
  CHZZK: "치지직",
  SOOP: "숲",
  YOUTUBE: "유튜브",
  OTHER: "기타",
};

function platformLabel(platform: string | null | undefined): string {
  if (!platform) return "";
  return PLATFORM_LABEL[platform] ?? platform;
}

export function ClipRecordCardDesktop({
  clip,
  onClick,
}: ClipRecordCardDesktopProps) {
  const timeLabel = formatTime(clip.createdAt);
  const platform = platformLabel(clip.platform);
  const durationLabel = formatDuration(clip.duration);

  const handleClick = () => onClick?.(clip);

  return (
    <div
      data-testid="clip-record-card-desktop"
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
        "bg-cyan-50 dark:bg-cyan-900/40 border-cyan-200 dark:border-cyan-900",
        // 좌측 strip
        "border-l-4 border-l-cyan-500",
        onClick && "cursor-pointer hover:shadow-md"
      )}
    >
      <div className="flex items-start gap-2">
        {clip.thumbnailUrl && (
          <div className="shrink-0">
            {/* 작은 썸네일 — next/image 의 srcSet 변환은 과한 cost. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={clip.thumbnailUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className="w-12 h-8 rounded object-cover bg-muted"
            />
          </div>
        )}
        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 text-sm font-semibold text-cyan-700 dark:text-cyan-300">
              <Film
                data-testid="clip-icon"
                className="size-3.5"
              />
              <span className="tabular-nums">{timeLabel}</span>
            </div>
            <Badge className="text-xs px-2 py-0.5 border-0 bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300 hidden xl:block">
              노래 클립
            </Badge>
          </div>
          <h4 className="text-sm font-bold line-clamp-2 leading-snug group-hover:text-primary transition-colors">
            {clip.title || "제목 없음"}
          </h4>
          {clip.songTitle && (
            <p className="text-xs text-muted-foreground line-clamp-1">
              <span aria-hidden="true">🎵 </span>
              {clip.songTitle}
            </p>
          )}
          <div className="flex items-center gap-2 pt-1 border-t border-border/50">
            {platform && (
              <span
                data-testid="clip-platform-badge"
                className="text-xs text-muted-foreground font-medium truncate"
              >
                {platform}
              </span>
            )}
            {durationLabel && (
              <span className="text-xs text-muted-foreground ml-auto tabular-nums">
                {durationLabel}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
