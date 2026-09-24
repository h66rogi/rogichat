'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { YT } from '@/meloming/domains/clip/utils/youtube-api';

export interface PlaybackProgress {
  currentTime: number;
  duration: number;
  state: 'playing' | 'paused' | 'ended' | 'buffering' | 'unstarted';
  percentage: number;
}

interface UseYouTubePlayerOptions {
  onProgress?: (progress: PlaybackProgress) => void;
  onStateChange?: (state: PlaybackProgress['state']) => void;
  onReady?: () => void;
  onError?: (error: number) => void;
  onPlaybackBlocked?: () => void; // 광고 또는 재생 불가 감지 시
  autoplay?: boolean;
  progressInterval?: number; // ms, default 1000
  playbackTimeout?: number; // ms, 재생 시작 대기 타임아웃 (default 5000)
}

// YouTube URL에서 video ID 추출
function extractVideoId(url: string): string | null {
  if (!url) return null;

  console.log('[YouTubePlayer] Extracting video ID from:', url);

  // youtube.com/watch?v=VIDEO_ID
  const watchMatch = url.match(/[?&]v=([^&]+)/);
  if (watchMatch) {
    console.log('[YouTubePlayer] Found watch URL, video ID:', watchMatch[1]);
    return watchMatch[1];
  }

  // youtu.be/VIDEO_ID
  const shortMatch = url.match(/youtu\.be\/([^?&]+)/);
  if (shortMatch) {
    console.log('[YouTubePlayer] Found short URL, video ID:', shortMatch[1]);
    return shortMatch[1];
  }

  // youtube.com/embed/VIDEO_ID
  const embedMatch = url.match(/youtube\.com\/embed\/([^?&]+)/);
  if (embedMatch) {
    console.log('[YouTubePlayer] Found embed URL, video ID:', embedMatch[1]);
    return embedMatch[1];
  }

  console.warn('[YouTubePlayer] Could not extract video ID from URL:', url);
  return null;
}

// YouTube API 로드
let apiLoaded = false;
let apiLoading = false;
const apiLoadCallbacks: (() => void)[] = [];

function loadYouTubeAPI(): Promise<void> {
  return new Promise((resolve) => {
    if (apiLoaded) {
      resolve();
      return;
    }

    apiLoadCallbacks.push(resolve);

    if (apiLoading) return;
    apiLoading = true;

    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    document.body.appendChild(script);

    window.onYouTubeIframeAPIReady = () => {
      apiLoaded = true;
      apiLoadCallbacks.forEach((cb) => cb());
      apiLoadCallbacks.length = 0;
    };
  });
}

function mapPlayerState(state: YT.PlayerState): PlaybackProgress['state'] {
  switch (state) {
    case YT.PlayerState.PLAYING:
      return 'playing';
    case YT.PlayerState.PAUSED:
      return 'paused';
    case YT.PlayerState.ENDED:
      return 'ended';
    case YT.PlayerState.BUFFERING:
      return 'buffering';
    default:
      return 'unstarted';
  }
}

export function useYouTubePlayer(
  containerId: string,
  videoUrl: string | null | undefined,
  options: UseYouTubePlayerOptions = {}
) {
  const {
    onProgress,
    onStateChange,
    onReady,
    onError,
    onPlaybackBlocked,
    autoplay = false,
    progressInterval = 1000,
    playbackTimeout = 5000,
  } = options;

  const playerRef = useRef<YT.Player | null>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isPlaybackCheckPending, setIsPlaybackCheckPending] = useState(false);
  const [currentProgress, setCurrentProgress] = useState<PlaybackProgress>({
    currentTime: 0,
    duration: 0,
    state: 'unstarted',
    percentage: 0,
  });

  // 콜백 refs (최신 상태 유지)
  const callbacksRef = useRef({ onProgress, onStateChange, onReady, onError, onPlaybackBlocked });
  useEffect(() => {
    callbacksRef.current = { onProgress, onStateChange, onReady, onError, onPlaybackBlocked };
  }, [onProgress, onStateChange, onReady, onError, onPlaybackBlocked]);

  // 재생 시작 타임아웃 ref
  const playbackTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasContentStartedRef = useRef(false);

  const clearPlaybackTimeout = useCallback(() => {
    if (playbackTimeoutRef.current) {
      clearTimeout(playbackTimeoutRef.current);
      playbackTimeoutRef.current = null;
    }
    setIsPlaybackCheckPending(false);
  }, []);

  const startPlaybackTimeout = useCallback(() => {
    if (hasContentStartedRef.current) return;
    if (playbackTimeoutRef.current) {
      clearTimeout(playbackTimeoutRef.current);
    }
    setIsPlaybackCheckPending(true);
    playbackTimeoutRef.current = setTimeout(() => {
      if (!hasContentStartedRef.current) {
        console.log('[YouTubePlayer] Playback timeout - content did not start');
        setIsPlaybackCheckPending(false);
        callbacksRef.current.onPlaybackBlocked?.();
      }
    }, playbackTimeout);
  }, [playbackTimeout]);

  // 진행률 업데이트
  const updateProgress = useCallback(() => {
    if (!playerRef.current) return;

    try {
      const currentTime = playerRef.current.getCurrentTime() || 0;
      const duration = playerRef.current.getDuration() || 0;
      const state = mapPlayerState(playerRef.current.getPlayerState());
      const percentage = duration > 0 ? (currentTime / duration) * 100 : 0;

      const progress: PlaybackProgress = {
        currentTime,
        duration,
        state,
        percentage,
      };

      setCurrentProgress(progress);
      callbacksRef.current.onProgress?.(progress);
    } catch {
      // Player might be destroyed
    }
  }, []);

  // 진행률 인터벌 시작/정지
  const startProgressInterval = useCallback(() => {
    if (progressIntervalRef.current) return;
    progressIntervalRef.current = setInterval(updateProgress, progressInterval);
  }, [updateProgress, progressInterval]);

  const stopProgressInterval = useCallback(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  }, []);

  // 비디오 ID 추출
  const videoId = videoUrl ? extractVideoId(videoUrl) : null;

  // 플레이어 초기화
  useEffect(() => {
    if (!videoId) {
      // 비디오 URL이 없으면 정리
      stopProgressInterval();
      clearPlaybackTimeout();
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
      setIsReady(false);
      return;
    }

    let mounted = true;
    let retryCount = 0;
    const maxRetries = 10;
    const retryDelay = 100; // ms

    const initPlayer = async () => {
      await loadYouTubeAPI();

      if (!mounted) return;

      // 기존 플레이어 정리
      if (playerRef.current) {
        stopProgressInterval();
        playerRef.current.destroy();
        playerRef.current = null;
      }

      // 컨테이너 존재 확인 (재시도 로직)
      const waitForContainer = (): Promise<HTMLElement | null> => {
        return new Promise((resolve) => {
          const checkContainer = () => {
            const container = document.getElementById(containerId);
            if (container) {
              resolve(container);
            } else if (retryCount < maxRetries && mounted) {
              retryCount++;
              setTimeout(checkContainer, retryDelay);
            } else {
              console.warn(`YouTube player container #${containerId} not found after ${maxRetries} retries`);
              resolve(null);
            }
          };
          checkContainer();
        });
      };

      const container = await waitForContainer();
      if (!container || !mounted) {
        return;
      }

      console.log('[YouTubePlayer] Creating player for video ID:', videoId);
      playerRef.current = new window.YT!.Player(containerId, {
        videoId,
        playerVars: {
          autoplay: autoplay ? 1 : 0,
          controls: 1,
          enablejsapi: 1,
          rel: 0,
          modestbranding: 1,
          fs: 1,
          disablekb: 0,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            if (!mounted) return;
            setIsReady(true);
            hasContentStartedRef.current = false;
            callbacksRef.current.onReady?.();

            // 자동재생일 때만 ready 직후 검사한다. 수동 재생은 사용자가 재생을 시도한 뒤 8초를 잰다.
            if (autoplay) {
              startPlaybackTimeout();
            }

            // 재생 중이면 인터벌 시작
            if (playerRef.current?.getPlayerState() === YT.PlayerState.PLAYING) {
              startProgressInterval();
            }
          },
          onStateChange: (event) => {
            if (!mounted) return;
            const state = mapPlayerState(event.data);
            callbacksRef.current.onStateChange?.(state);

            // 재생 중일 때만 인터벌 실행
            if (event.data === YT.PlayerState.PLAYING) {
              startProgressInterval();
              startPlaybackTimeout();

              // 광고 여부 확인 - getVideoData로 현재 재생 중인 비디오 ID 확인
              try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const videoData = (playerRef.current as any)?.getVideoData?.();
                const currentVideoId = videoData?.video_id;

                // 재생 중인 비디오 ID가 요청한 ID와 다르면 광고로 간주
                if (currentVideoId && currentVideoId !== videoId) {
                  console.log('[YouTubePlayer] Ad detected - video ID mismatch:', currentVideoId, 'vs', videoId);
                  clearPlaybackTimeout();
                  callbacksRef.current.onPlaybackBlocked?.();
                } else if (currentVideoId === videoId) {
                  // 실제 콘텐츠 재생 시작됨
                  hasContentStartedRef.current = true;
                  clearPlaybackTimeout();
                }
              } catch {
                // getVideoData 실패 시 무시
              }
            } else if (event.data === YT.PlayerState.BUFFERING) {
              startPlaybackTimeout();
            } else {
              clearPlaybackTimeout();
              stopProgressInterval();
              // 마지막 상태 업데이트
              updateProgress();
            }
          },
          onError: (event) => {
            if (!mounted) return;
            clearPlaybackTimeout();
            callbacksRef.current.onError?.(event.data);
          },
        },
      });
    };

    initPlayer();

    return () => {
      mounted = false;
      stopProgressInterval();
      clearPlaybackTimeout();
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
      setIsReady(false);
      hasContentStartedRef.current = false;
    };
  }, [
    videoId,
    containerId,
    autoplay,
    startPlaybackTimeout,
    clearPlaybackTimeout,
    startProgressInterval,
    stopProgressInterval,
    updateProgress,
  ]);

  // 컨트롤 함수들
  const play = useCallback(() => {
    if (!playerRef.current) return;
    playerRef.current.playVideo();
    startPlaybackTimeout();
  }, [startPlaybackTimeout]);

  const pause = useCallback(() => {
    playerRef.current?.pauseVideo();
  }, []);

  const seekTo = useCallback((seconds: number) => {
    playerRef.current?.seekTo(seconds, true);
  }, []);

  const setVolume = useCallback((volume: number) => {
    playerRef.current?.setVolume(Math.max(0, Math.min(100, volume)));
  }, []);

  const getVolume = useCallback(() => {
    return playerRef.current?.getVolume() ?? 100;
  }, []);

  const mute = useCallback(() => {
    playerRef.current?.mute();
  }, []);

  const unmute = useCallback(() => {
    playerRef.current?.unMute();
  }, []);

  const isMuted = useCallback(() => {
    return playerRef.current?.isMuted() ?? false;
  }, []);

  // 가사 패널 등에서 RAF 루프로 직접 polling 하기 위한 currentTime accessor.
  // 기존 onProgress 콜백은 progressInterval(기본 1000ms) + publish throttle을
  // 거치므로 ms 단위 highlight 에는 부적합. 이 함수는 player 내부 시각을 즉시
  // 반환한다 (player 미준비 시 0).
  const getCurrentTime = useCallback(() => {
    return playerRef.current?.getCurrentTime() ?? 0;
  }, []);

  return {
    isReady,
    isPlaybackCheckPending,
    progress: currentProgress,
    play,
    pause,
    seekTo,
    setVolume,
    getVolume,
    mute,
    unmute,
    isMuted,
    getCurrentTime,
    videoId,
  };
}
