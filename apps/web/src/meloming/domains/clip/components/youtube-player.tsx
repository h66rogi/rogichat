"use client";

import { useEffect, useRef, useCallback, memo } from "react";
import { loadYouTubeApi, YT } from "@/meloming/domains/clip/utils/youtube-api";

interface YouTubePlayerProps {
  videoId: string;
  autoplay?: boolean;
  onEnded?: () => void;
  onReady?: () => void;
  className?: string;
}

/**
 * YouTube 공식 IFrame Player API를 사용하는 플레이어
 * - 영상 종료 이벤트를 정확하게 감지
 * - autoplay, 영상 상태 제어 가능
 * - 브라우저 탭이 비활성 상태에서도 visibility 변경 시 재생 시도
 */
export const YouTubePlayer = memo(function YouTubePlayer({
  videoId,
  autoplay = false,
  onEnded,
  onReady,
  className,
}: YouTubePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YT.Player | null>(null);
  const videoIdRef = useRef(videoId);
  const autoplayRef = useRef(autoplay);
  // autoplay가 요청되었지만 아직 재생이 시작되지 않은 상태 추적
  const pendingAutoplayRef = useRef(autoplay);

  // 초기값 저장 (리렌더링 시 변경 방지)
  useEffect(() => {
    videoIdRef.current = videoId;
    autoplayRef.current = autoplay;
    pendingAutoplayRef.current = autoplay;
  }, []);

  // 상태 변경 핸들러
  const handleStateChange = useCallback(
    (event: YT.PlayerEvent) => {
      // 재생이 시작되면 pending autoplay 해제
      if (event.data === YT.PlayerState.PLAYING) {
        pendingAutoplayRef.current = false;
      }
      if (event.data === YT.PlayerState.ENDED) {
        onEnded?.();
      }
    },
    [onEnded]
  );

  // Page Visibility API를 통한 자동재생 복구
  // 브라우저 탭이 비활성→활성 상태가 될 때 pending autoplay 시도
  useEffect(() => {
    if (!autoplayRef.current) return;

    const handleVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        pendingAutoplayRef.current &&
        playerRef.current
      ) {
        try {
          const state = playerRef.current.getPlayerState?.();
          // UNSTARTED(-1), CUED(5), PAUSED(2) 상태일 때만 재생 시도
          if (state === -1 || state === 5 || state === 2) {
            playerRef.current.playVideo?.();
          }
        } catch {
          // 플레이어가 아직 준비되지 않은 경우 무시
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // 플레이어 초기화
  useEffect(() => {
    let player: YT.Player | null = null;
    let isMounted = true;

    const initPlayer = async () => {
      try {
        await loadYouTubeApi();

        if (!isMounted || !containerRef.current || !window.YT?.Player) return;

        // 고유 ID 생성
        const playerId = `yt-player-${videoIdRef.current}-${Date.now()}`;
        containerRef.current.id = playerId;

        player = new window.YT.Player(playerId, {
          videoId: videoIdRef.current,
          width: "100%",
          height: "100%",
          playerVars: {
            autoplay: autoplayRef.current ? 1 : 0,
            rel: 0,
            modestbranding: 1,
            enablejsapi: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              if (isMounted) {
                // autoplay가 브라우저 정책으로 막힐 수 있으므로 명시적으로 재생 시도
                if (autoplayRef.current && player) {
                  try {
                    player.playVideo?.();
                  } catch {
                    // 재생 실패 시 visibility change에서 재시도
                  }
                }
                onReady?.();
              }
            },
            onStateChange: (event) => {
              if (isMounted) {
                handleStateChange(event);
              }
            },
          },
        });

        playerRef.current = player;
      } catch (error) {
        console.error("Failed to initialize YouTube player:", error);
      }
    };

    initPlayer();

    return () => {
      isMounted = false;
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // 이미 제거된 경우 무시
        }
        playerRef.current = null;
      }
    };
  }, [handleStateChange, onReady]);

  return (
    <div className={className}>
      <div
        ref={containerRef}
        className="w-full h-full"
      />
    </div>
  );
});
