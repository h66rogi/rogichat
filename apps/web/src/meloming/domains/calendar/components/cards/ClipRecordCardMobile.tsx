"use client";

import type { CalendarClipRecord } from "@/meloming/domains/calendar/types/channel-calendar";
import { Badge } from "@/meloming/shared/components/ui/badge";
import { Film } from "lucide-react";
import { cn } from "@/meloming/shared/lib/utils";

type ClipRecordCardMobileProps = {
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

export function ClipRecordCardMobile({
  clip,
  onClick,
}: ClipRecordCardMobileProps) {
  const timeLabel = formatTime(clip.createdAt);
  const platform = platformLabel(clip.platform);
  const durationLabel = formatDuration(clip.duration);

  const handleClick = () => onClick?.(clip);

  return (
    <div
      data-testid="clip-record-card-mobile"
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
        "rounded-md p-3 transition-transform",
        "bg-cyan-50 dark:bg-cyan-900/40",
        "border border-cyan-200 dark:border-cyan-900",
        // strip 은 border-l-4 + cyan-500 으로 좌측 굵은 색상 라인.
        // tailwind-merge 가 border 와 border-l-4 을 병합하지 않도록 마지막에 둔다.
        "border-l-4 border-l-cyan-500",
        onClick && "cursor-pointer active:scale-[0.98]"
      )}
    >
      <div className="flex items-start gap-2.5">
        {clip.thumbnailUrl && (
          <div className="shrink-0">
            {/* 작은 썸네일 — next/image 의 srcSet 변환은 과한 cost. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={clip.thumbnailUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className="w-[60px] h-[40px] rounded object-cover bg-muted"
            />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <div className="flex items-center gap-1 text-xs font-semibold text-cyan-700 dark:text-cyan-300">
              <Film
                data-testid="clip-icon"
                className="size-3"
              />
              <span>{timeLabel}</span>
            </div>
            <Badge className="text-[10px] px-1.5 py-0 h-5 border-0 bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300">
              노래 클립
            </Badge>
            {platform && (
              <span
                data-testid="clip-platform-badge"
                className="text-[10px] text-muted-foreground"
              >
                {platform}
              </span>
            )}
          </div>
          <p className="text-base font-semibold mb-1 line-clamp-2 leading-snug">
            {clip.title || "제목 없음"}
          </p>
          {clip.songTitle && (
            <p className="text-xs text-muted-foreground line-clamp-1">
              <span aria-hidden="true">🎵 </span>
              {clip.songTitle}
            </p>
          )}
          {durationLabel && (
            <p className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
              {durationLabel}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
