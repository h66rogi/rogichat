"use client";

import { useEffect, useMemo, memo, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/meloming/shared/components/ui/button";
import { YouTubePlayer } from "./youtube-player";
import type { ClipPlatform } from "@/meloming/domains/clip/types/clip";
import { captureIntentEvent } from "@/meloming/shared/analytics/intentional-events";

interface ClipPlayerProps {
  clipId?: number;
  platform: ClipPlatform;
  videoId?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  title: string;
  autoplay?: boolean;
  /** 영상 종료 시 호출되는 콜백 (YouTube 만 지원 — iframe 임베드는 종료 감지 불가). */
  onEnded?: () => void;
}

function isChzzkVideo(videoUrl?: string): boolean {
  if (!videoUrl) return false;
  try {
    const url = new URL(videoUrl);
    return (
      url.hostname.includes("chzzk.naver.com") &&
      url.pathname.includes("/video/")
    );
  } catch {
    return false;
  }
}

function extractYouTubeVideoId(videoId?: string, videoUrl?: string): string | null {
  if (videoId) return videoId;
  if (!videoUrl) return null;

  try {
    const url = new URL(videoUrl);
    if (url.hostname.includes("youtube.com")) {
      if (url.pathname.includes("/embed/")) {
        return url.pathname.split("/embed/")[1]?.split("?")[0] ?? null;
      }
      return url.searchParams.get("v");
    } else if (url.hostname.includes("youtu.be")) {
      return url.pathname.slice(1).split("?")[0];
    }
  } catch {
    return null;
  }
  return null;
}

function getEmbedUrl(
  platform: ClipPlatform,
  videoId?: string,
  videoUrl?: string,
  autoplay?: boolean
): string | null {
  if (platform === "YOUTUBE") return null;

  if (videoId) {
    switch (platform) {
      case "SOOP":
        return `https://vod.afreecatv.com/player/${videoId}/embed?autoPlay=${autoplay ? "true" : "false"}`;
      case "CHZZK":
        return `https://chzzk.naver.com/embed/clip/${videoId}?autoplay=${autoplay ? "true" : "false"}`;
      default:
        break;
    }
  }

  if (videoUrl) {
    try {
      const url = new URL(videoUrl);

      switch (platform) {
        case "SOOP": {
          if (
            url.hostname.includes("afreecatv.com") ||
            url.hostname.includes("sooplive.co.kr")
          ) {
            const pathParts = url.pathname.split("/");
            const vid = pathParts[pathParts.length - 1];
            if (vid) {
              return `https://vod.afreecatv.com/player/${vid}/embed?autoPlay=${autoplay ? "true" : "false"}`;
            }
          }
          break;
        }

        case "CHZZK": {
          if (url.hostname.includes("chzzk.naver.com")) {
            const pathParts = url.pathname.split("/");
            const clipIndex = pathParts.indexOf("clips");
            if (clipIndex !== -1 && pathParts[clipIndex + 1]) {
              const vid = pathParts[clipIndex + 1];
              return `https://chzzk.naver.com/embed/clip/${vid}?autoplay=${autoplay ? "true" : "false"}`;
            }
          }
          break;
        }

        default:
          break;
      }

      return videoUrl;
    } catch {
      return videoUrl;
    }
  }

  return null;
}

function getEmbedPlayerSummary({
  clipId,
  platform,
  videoId,
  videoUrl,
  thumbnailUrl,
  autoplay,
  youtubeVideoId,
  embedUrl,
  originalUrl,
  isVideoNotEmbeddable,
}: {
  clipId?: number;
  platform: ClipPlatform;
  videoId?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  autoplay: boolean;
  youtubeVideoId: string | null;
  embedUrl: string | null;
  originalUrl: string | null;
  isVideoNotEmbeddable: boolean;
}) {
  return {
    funnel: "clip_consumption",
    clip_id: clipId ?? null,
    platform,
    autoplay,
    has_video_id: Boolean(videoId),
    has_video_url: Boolean(videoUrl),
    has_thumbnail_url: Boolean(thumbnailUrl),
    youtube_video_id_resolved: Boolean(youtubeVideoId),
    embed_url_resolved: Boolean(embedUrl),
    original_url_resolved: Boolean(originalUrl),
    chzzk_video_not_embeddable: isVideoNotEmbeddable,
  };
}

/**
 * YouTube / SOOP / CHZZK 임베드 플레이어. DIRECT_FILE (Meloming Clip) 은
 * GlobalClipPlayer 단에서 MelomingClipPlayer 로 분기하므로 이 컴포넌트는 처리하지 않는다.
 */
export const ClipPlayer = memo(function ClipPlayer({
  clipId,
  platform,
  videoId,
  videoUrl,
  thumbnailUrl,
  title,
  autoplay = false,
  onEnded,
}: ClipPlayerProps) {
  const isVideoNotEmbeddable = platform === "CHZZK" && isChzzkVideo(videoUrl);
  const renderSignatureRef = useRef<string | null>(null);

  const [initialAutoplay] = useState(() => autoplay);

  const youtubeVideoId = useMemo(
    () => (platform === "YOUTUBE" ? extractYouTubeVideoId(videoId, videoUrl) : null),
    [platform, videoId, videoUrl]
  );

  const embedUrl = useMemo(
    () => (isVideoNotEmbeddable ? null : getEmbedUrl(platform, videoId, videoUrl, initialAutoplay)),
    [platform, videoId, videoUrl, isVideoNotEmbeddable, initialAutoplay]
  );

  const originalUrl = useMemo(() => {
    if (videoUrl) return videoUrl;
    if (!videoId) return null;

    switch (platform) {
      case "YOUTUBE":
        return `https://www.youtube.com/watch?v=${videoId}`;
      case "SOOP":
        return `https://vod.afreecatv.com/player/${videoId}`;
      case "CHZZK":
        return `https://chzzk.naver.com/clips/${videoId}`;
      default:
        return null;
    }
  }, [platform, videoId, videoUrl]);

  const embedSummary = useMemo(
    () =>
      getEmbedPlayerSummary({
        clipId,
        platform,
        videoId,
        videoUrl,
        thumbnailUrl,
        autoplay: initialAutoplay,
        youtubeVideoId,
        embedUrl,
        originalUrl,
        isVideoNotEmbeddable,
      }),
    [
      clipId,
      embedUrl,
      initialAutoplay,
      isVideoNotEmbeddable,
      originalUrl,
      platform,
      thumbnailUrl,
      videoId,
      videoUrl,
      youtubeVideoId,
    ],
  );

  useEffect(() => {
    const renderState = isVideoNotEmbeddable
      ? "external_required"
      : platform === "YOUTUBE" && youtubeVideoId
        ? "youtube_player"
        : embedUrl
          ? "iframe_embed"
          : "unplayable";
    const renderSignature = `${clipId ?? "unknown"}:${platform}:${renderState}`;
    if (renderSignatureRef.current === renderSignature) return;
    renderSignatureRef.current = renderSignature;
    captureIntentEvent("clip_player_embed_rendered", {
      ...embedSummary,
      render_state: renderState,
    });
  }, [
    clipId,
    embedSummary,
    embedUrl,
    isVideoNotEmbeddable,
    platform,
    youtubeVideoId,
  ]);

  if (isVideoNotEmbeddable && originalUrl) {
    return (
      <div className="aspect-video w-full rounded-lg overflow-hidden bg-muted relative group">
        {thumbnailUrl && (
          <img
            src={thumbnailUrl}
            alt={title}
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-4 p-4">
          <p className="text-white text-center text-sm">
            치지직 비디오는 임베드를 지원하지 않습니다.
          </p>
          <Button asChild variant="secondary" size="lg">
            <a
              href={originalUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() =>
                captureIntentEvent("clip_player_embed_external_open_clicked", {
                  ...embedSummary,
                  external_reason: "chzzk_video_not_embeddable",
                })
              }
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              치지직에서 보기
            </a>
          </Button>
        </div>
      </div>
    );
  }

  if (platform === "YOUTUBE" && youtubeVideoId) {
    return (
      <div className="aspect-video w-full rounded-lg overflow-hidden bg-black">
        <YouTubePlayer
          key={youtubeVideoId}
          videoId={youtubeVideoId}
          autoplay={initialAutoplay}
          onEnded={onEnded}
          className="w-full h-full"
        />
      </div>
    );
  }

  if (!embedUrl) {
    return (
      <div className="aspect-video bg-muted flex items-center justify-center rounded-lg">
        <p className="text-muted-foreground">
          영상을 로드할 수 없습니다.
          {originalUrl && (
            <a
              href={originalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline ml-1"
              onClick={() =>
                captureIntentEvent("clip_player_embed_external_open_clicked", {
                  ...embedSummary,
                  external_reason: "embed_url_missing",
                })
              }
            >
              원본 링크에서 보기
            </a>
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="aspect-video w-full rounded-lg overflow-hidden bg-black">
      <iframe
        key={embedUrl}
        src={embedUrl}
        title={title}
        className="w-full h-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
    </div>
  );
});
