"use client";

import { Share2 } from "lucide-react";
import { cn } from "@/meloming/shared/lib/utils";

/**
 * MetaOverlay 가 표시하는 채널 정보 — clip / live 양쪽에서 같은 모양으로 매핑 가능한
 * 최소 필드만 노출. ClipChannelResponse 가 이 형태의 superset 이라 그대로 전달 가능.
 */
export interface PlayerChannelInfo {
  channelName: string;
  channelWebPath?: string;
  channelProfileImageUrl?: string | null;
}

interface MetaOverlayProps {
  title: string;
  primaryChannel: PlayerChannelInfo | undefined;
  /** 클립: 조회수. 라이브 모드에서는 undefined. */
  viewCount: number | undefined;
  /** 클립: 작성일. 라이브 모드에서는 미사용. */
  createdAt?: string;
  /** 라이브: 현재 시청자 수. 클립 모드에서는 undefined. */
  viewerCount?: number;
  /** 라이브 모드 — createdAt/viewCount 대신 LIVE 배지 + viewerCount 표시. */
  isLive?: boolean;
  visible: boolean;
  /** 클립 자체 페이지 / 라이브 시청 페이지 URL — 멜로밍 로고 클릭 시 이 URL 로 이동. */
  publicUrl: string;
  publicUrlLabel?: string;
  onShare: () => void;
}

function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diffSec < 60) return "방금 전";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}분 전`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}시간 전`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR");
}

function formatCount(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 10000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 10000).toFixed(1)}만`;
}

const TEXT_SHADOW = "[text-shadow:0_1px_3px_rgba(0,0,0,0.85)]";

export function MetaOverlay({
  title,
  primaryChannel,
  viewCount,
  createdAt,
  viewerCount,
  isLive = false,
  visible,
  publicUrl,
  publicUrlLabel = "멜로밍에서 이 클립 보기",
  onShare,
}: MetaOverlayProps) {
  const channelHref = primaryChannel?.channelWebPath
    ? `/channel/${primaryChannel.channelWebPath}`
    : null;

  const channelProfile = primaryChannel?.channelProfileImageUrl ? (
    <img
      src={primaryChannel.channelProfileImageUrl}
      alt={primaryChannel.channelName ?? ""}
      className="size-9 shrink-0 rounded-full object-cover ring-1 ring-white/20"
    />
  ) : (
    <div className="size-9 shrink-0 rounded-full bg-white/20" />
  );

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-4",
        "bg-gradient-to-b from-black/80 via-black/40 to-transparent motion-safe:transition-opacity motion-safe:duration-200",
        visible ? "opacity-100" : "opacity-0"
      )}
    >
      <div className="pointer-events-auto flex min-w-0 items-center gap-3">
        {channelHref ? (
          <a
            href={channelHref}
            aria-label={`${primaryChannel?.channelName ?? "채널"} 페이지로 이동`}
            className="shrink-0 rounded-full"
          >
            {channelProfile}
          </a>
        ) : (
          channelProfile
        )}
        <div className={cn("min-w-0 text-white", TEXT_SHADOW)}>
          {primaryChannel?.channelName ? (
            channelHref ? (
              <a
                href={channelHref}
                className="block truncate text-sm font-bold hover:underline"
              >
                {primaryChannel.channelName}
              </a>
            ) : (
              <div className="truncate text-sm font-bold">
                {primaryChannel.channelName}
              </div>
            )
          ) : null}
          <div className="truncate text-sm font-medium">{title}</div>
          <div className="mt-0.5 truncate text-xs font-medium text-white/95">
            {isLive ? (
              <>
                <span className="mr-1.5 inline-flex items-center gap-1 rounded bg-red-600 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                  <span className="size-1 animate-pulse rounded-full bg-white" />
                  LIVE
                </span>
                {typeof viewerCount === "number"
                  ? `${viewerCount.toLocaleString()}명 시청 중`
                  : ""}
              </>
            ) : (
              <>
                {typeof viewCount === "number"
                  ? `조회수 ${formatCount(viewCount)}회 · `
                  : ""}
                {createdAt ? formatRelativeTime(createdAt) : ""}
              </>
            )}
          </div>
        </div>
      </div>

      {!isLive && (
        <div className="pointer-events-auto flex shrink-0 flex-col items-end gap-2">
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={publicUrlLabel}
            className="inline-flex items-center justify-center rounded-md p-1 hover:bg-white/10"
          >
            <img
              src="/logo/meloming-logo-512.png"
              alt="Meloming"
              width={24}
              height={24}
              className="size-6 rounded-md object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]"
            />
          </a>
          <button
            type="button"
            onClick={onShare}
            aria-label="공유"
            className="inline-flex size-9 items-center justify-center rounded-full bg-black/50 text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)] hover:bg-black/70 focus:bg-black/70 focus:outline-none"
          >
            <Share2 className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
