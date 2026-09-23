"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/meloming/shared/lib/utils";
import { ClipPlatformBadge } from "./clip-platform-badge";
import { formatDuration, formatCount, formatRelativeTime } from "../utils/format";
import type { Clip } from "@/meloming/domains/clip/types/clip";
import { Eye, Play } from "lucide-react";
import { captureIntentEvent } from "@/meloming/shared/analytics/intentional-events";

interface ClipCardHorizontalProps {
  clip: Clip;
  className?: string;
  currentClipId?: number;
  /** 추천 순위 표시 (1, 2, 3...) */
  showIndex?: number;
  /** 다음 재생될 클립인지 여부 */
  isNextUp?: boolean;
}

export function ClipCardHorizontal({
  clip,
  className,
  currentClipId,
  showIndex,
  isNextUp,
}: ClipCardHorizontalProps) {
  const [thumbnailError, setThumbnailError] = useState(false);
  const channel = clip.channels[0];
  const isCurrentClip = currentClipId === clip.id;

  return (
    <Link
      href={`/clip/${clip.id}`}
      className={cn("block", isCurrentClip && "pointer-events-none")}
      onClick={() =>
        captureIntentEvent("clip_card_horizontal_clicked", {
          funnel: "clip_consumption",
          clip_id: clip.id,
          current_clip_id: currentClipId ?? null,
          is_current_clip: isCurrentClip,
          is_next_up: Boolean(isNextUp),
          recommendation_rank: showIndex ?? null,
          platform: clip.platform,
          media_type: clip.mediaType ?? null,
          duration_seconds: clip.duration ?? null,
          view_count: clip.stat?.viewCount ?? 0,
        })
      }
    >
      <article
        className={cn(
          "group flex gap-2 rounded-md overflow-hidden hover:bg-muted/50 transition-colors cursor-pointer p-1",
          isCurrentClip && "bg-muted/70",
          className
        )}
      >
        {/* 썸네일 */}
        <div className="relative w-40 min-w-40 aspect-video bg-muted rounded-md overflow-hidden">
          {clip.thumbnailUrl && !thumbnailError ? (
            <img
              src={clip.thumbnailUrl}
              alt={clip.title}
              className="w-full h-full object-cover"
              loading="lazy"
              onError={() => setThumbnailError(true)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gray-200 dark:bg-gray-800">
              <Play className="size-8 text-muted-foreground" />
            </div>
          )}

          {/* 영상 길이 */}
          {clip.duration != null && (
            <div className="absolute bottom-1 right-1 bg-black/80 text-white text-xs px-1 py-0.5 rounded text-[10px]">
              {formatDuration(clip.duration)}
            </div>
          )}

          <div className="absolute top-1 left-1">
            <ClipPlatformBadge platform={clip.platform} size="sm" />
          </div>

          {/* 호버 오버레이 */}
          {!isCurrentClip && (
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
              <Play className="size-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          )}

          {/* 현재 재생중 표시 */}
          {isCurrentClip && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <span className="text-white text-xs font-medium bg-primary px-2 py-1 rounded">
                재생중
              </span>
            </div>
          )}

          {/* 다음 재생 표시 */}
          {isNextUp && !isCurrentClip && (
            <div className="absolute top-1 right-1 bg-primary text-primary-foreground text-[10px] font-medium px-1.5 py-0.5 rounded">
              다음 재생
            </div>
          )}

          {/* 순위 표시 */}
          {showIndex && !isCurrentClip && (
            <div className="absolute bottom-1 left-1 bg-black/70 text-white text-xs font-bold w-5 h-5 flex items-center justify-center rounded">
              {showIndex}
            </div>
          )}
        </div>

        {/* 내용 */}
        <div className="flex-1 min-w-0 py-0.5">
          {/* 제목 */}
          <h3 className="font-medium text-sm line-clamp-2 leading-snug group-hover:text-primary transition-colors">
            {clip.title}
          </h3>

          {/* 채널명 */}
          {channel && (
            <p className="text-xs text-muted-foreground mt-1 truncate">
              {channel.channelName}
            </p>
          )}

          {/* 조회수 & 날짜 */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
            <span className="flex items-center gap-1">
              <Eye className="size-3" />
              {formatCount(clip.stat?.viewCount ?? 0)}
            </span>
            <span>{formatRelativeTime(clip.createdAt)}</span>
          </div>
        </div>
      </article>
    </Link>
  );
}
