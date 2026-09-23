"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAtom } from "jotai";
import { toast } from "sonner";
import { cn } from "@/meloming/shared/lib/utils";
import type { Clip } from "@/meloming/domains/clip/types/clip";
import { useAutoClipPlayUrl } from "@/meloming/domains/clip/hooks/use-clips";
import { playerVolumeAtom, playerMutedAtom } from "@/meloming/domains/clip/atoms/clip-player-atom";
import { pickEngine } from "./engine/pick-engine";
import { HlsEngine, type HlsEngineFatalError, type HlsLatencyMode } from "./engine/hls-engine";
import type { MediaEngine, VideoQuality } from "./engine/media-engine";
import { usePlayerState } from "./hooks/use-player-state";
import { useKeyboardShortcuts } from "./hooks/use-keyboard-shortcuts";
import { useAutoHideControls } from "./hooks/use-auto-hide-controls";
import { MetaOverlay, type PlayerChannelInfo } from "./overlays/meta-overlay";
import { PlayOverlay } from "./overlays/play-overlay";
import { ControlBar } from "./controls/control-bar";
import { ContextMenu, type ContextMenuItem } from "./controls/context-menu";
import { SharePopover } from "./controls/share-popover";
import { getPlayback } from "@/meloming/domains/live/apis/live-service-api";
import type { LiveStatus } from "@/meloming/domains/live/types/live";
import { captureIntentEvent } from "@/meloming/shared/analytics/intentional-events";

// 공유 링크 / 임베드 코드의 base URL.
// NEXT_PUBLIC_BASE_URL 환경변수 (qa/prod 별 다른 값) 사용. Next.js 가 client
// bundle 에 inline 하므로 SSR/client 동일.
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "https://meloming.com";

/**
 * 라이브 시청 모드 입력. `clip` 과 mutually exclusive.
 *
 * clip 도메인의 player 가 라이브에서도 같은 UI/UX (MetaOverlay, ControlBar, PlayOverlay,
 * SharePopover, ContextMenu, 키보드 단축키) 를 제공하도록 통합. seek 의미 없는 항목
 * (progress bar, time, speed, 0-9 jump 등) 은 isLive 분기로 숨김.
 */
export interface LivePlayerMedia {
  publicId: string;
  title: string;
  status: LiveStatus;
  viewerCount: number;
  channel: PlayerChannelInfo;
  /** HLS fatal recover 한계 도달 시 호출 — caller 가 사용자 안내 UI 표시. */
  onFatalError?: (error: HlsEngineFatalError) => void;
}

export interface DirectPlayerMedia {
  id: string | number;
  title: string;
  src: string;
  poster?: string | null;
  publicUrl?: string;
  createdAt?: string;
  channel?: PlayerChannelInfo;
}

interface MelomingClipPlayerProps {
  /** 클립 시청 모드. live 와 동시 사용 불가. */
  clip?: Clip;
  /** 라이브 시청 모드. clip 과 동시 사용 불가. */
  live?: LivePlayerMedia;
  /** 일반 직접 업로드 미디어 시청 모드. clip/live 와 동시 사용 불가. */
  media?: DirectPlayerMedia;
  /** "inline" 은 메인/상세 페이지 기본 모드, "embed" 는 /embed/clip/:id 외부 임베드 */
  mode?: "inline" | "embed";
  /** 게시글 본문처럼 제목/채널 정보가 이미 주변 UI에 있는 경우 상단 메타 오버레이를 끈다. */
  showMetaOverlay?: boolean;
  autoplay?: boolean;
  onEnded?: () => void;
}

function isExpectedMediaError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === "NotAllowedError" || name === "AbortError";
}

function buildEmbedCode(clipId: number): string {
  return `<iframe src="${BASE_URL}/embed/clip/${clipId}" width="560" height="315" frameborder="0" allow="autoplay; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function MelomingClipPlayer({
  clip,
  live,
  media,
  mode = "inline",
  showMetaOverlay = true,
  autoplay = false,
  onEnded,
}: MelomingClipPlayerProps) {
  const mediaModeCount = [clip, live, media].filter(Boolean).length;
  if (mediaModeCount !== 1) {
    throw new Error(
      "MelomingClipPlayer: clip, live, media 중 정확히 하나만 지정해야 합니다.",
    );
  }

  const isLive = !!live;
  const isDirectMedia = !!media;
  const isClip = !!clip;

  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [capabilities, setCapabilities] = useState({
    pip: false,
    fullscreen: false,
  });

  const [initialAutoplay] = useState(() => autoplay);

  useEffect(() => {
    setCapabilities({
      pip: Boolean(document.pictureInPictureEnabled),
      fullscreen: Boolean(document.fullscreenEnabled),
    });
  }, []);

  // ── 볼륨/음소거 유지 (클립 전환·세션 간) ──────────────────────────────────
  // 클립이 바뀌면 이 컴포넌트가 통째로 remount → 새 video element 가 기본 볼륨(1)으로
  // 시작한다. localStorage atom 값을 새 element 에 복원하고, 사용자가 바꾼 값을 다시
  // 저장해 다음 클립/세션에 유지한다. 복원 effect 는 usePlayerState 의 mount 동기화보다
  // 먼저 실행되도록(이 위치) 두어, 초기 볼륨 1 이 저장값을 덮어쓰지 않게 한다.
  const [storedVolume, setStoredVolume] = useAtom(playerVolumeAtom);
  const [storedMuted, setStoredMuted] = useAtom(playerMutedAtom);
  const storedVolumeRef = useRef(storedVolume);
  const storedMutedRef = useRef(storedMuted);
  const volumeRestoredRef = useRef(false);
  useEffect(() => {
    storedVolumeRef.current = storedVolume;
    storedMutedRef.current = storedMuted;
  }, [storedVolume, storedMuted]);
  useEffect(() => {
    if (!videoEl) return;
    videoEl.volume = Math.max(0, Math.min(1, storedVolumeRef.current));
    // muted 는 라이브 muted-autoplay 정책과 충돌하지 않도록 클립에서만 복원
    if (!isLive) videoEl.muted = storedMutedRef.current;
    volumeRestoredRef.current = true;
  }, [videoEl, isLive]);
  const [contextMenu, setContextMenu] = useState<
    { x: number; y: number; w: number; h: number } | null
  >(null);
  const [sharePopOpen, setSharePopOpen] = useState(false);

  // ── 소스 결정 ────────────────────────────────────────────────────────────
  // clip: 기존 로직 (presigned URL fetch 또는 직접 URL)
  // media: 게시판 첨부 등 이미 접근 가능한 직접 업로드 URL
  // live: getPlayback() 으로 m3u8 fetch
  const isSelfHostedDirect =
    isClip &&
    clip.mediaType === "DIRECT_FILE" &&
    clip.selfHosted === true &&
    typeof clip.id === "number";

  const playUrlQuery = useAutoClipPlayUrl(clip?.id, {
    enabled: isSelfHostedDirect,
  });

  const directUrl =
    isClip && clip.mediaType === "DIRECT_FILE" && !clip.selfHosted
      ? clip.videoUrl ?? null
      : null;

  const [liveSrc, setLiveSrc] = useState<string | null>(null);
  const [liveSrcError, setLiveSrcError] = useState<string | null>(null);
  /**
   * 라이브 시청 정지 (Stop 버튼) 상태. true 면 PlayOverlay 가 "다시 입장" 으로
   * 노출되어 사용자가 재진입 가능. engine instance 는 그대로 유지 (stop/start API
   * 로 fragment 다운로드만 토글) → 재진입 race 없음.
   */
  const [liveStopped, setLiveStopped] = useState(false);
  /** 라이브 지연 모드 — 변경 시 hls.js instance 재생성 (useEffect dep). */
  const [latencyMode, setLatencyMode] = useState<HlsLatencyMode>("low");

  useEffect(() => {
    if (!isLive) return;
    if (live!.status === "ENDED" || live!.status === "FAILED") return;
    let cancelled = false;
    (async () => {
      try {
        const playback = await getPlayback(live!.publicId);
        if (cancelled) return;
        if (playback.playbackUrl) {
          setLiveSrc(playback.playbackUrl);
          setLiveSrcError(null);
        } else {
          setLiveSrcError("방송을 불러올 수 없습니다.");
        }
      } catch (err) {
        if (!cancelled) {
          setLiveSrcError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLive, live?.publicId, live?.status]);

  const src = isLive
    ? liveSrc
    : isDirectMedia
      ? media.src
      : (playUrlQuery.data?.url ?? directUrl ?? null);

  // ── 엔진 attach ──────────────────────────────────────────────────────────
  // 라이브는 HlsEngine 을 직접 생성해 onFatalError + latencyMode 옵션을 등록.
  // clip 은 pickEngine 으로 mediaType 분기.
  const [engine, setEngine] = useState<MediaEngine | null>(null);

  useEffect(() => {
    if (!videoEl || !src) return;
    const e: MediaEngine = isLive
      ? new HlsEngine({
          latencyMode,
          onFatalError: (error) => {
            live!.onFatalError?.(error);
          },
        })
      : pickEngine({
          engineKind:
            isDirectMedia || clip?.mediaType === "DIRECT_FILE"
              ? "DIRECT_FILE"
              : undefined,
          url: src,
        });
    setEngine(e);

    let cancelled = false;
    e.attach(videoEl, src, { autoplay: initialAutoplay })
      .then(async () => {
        if (cancelled) return;
        captureIntentEvent("clip_player_engine_attached", {
          funnel: "clip_consumption",
          clip_id: clip?.id ?? null,
          media_id: media?.id ?? null,
          live_public_id: live?.publicId ?? null,
          is_live: isLive,
          initial_autoplay: initialAutoplay,
          mode,
        });
        if (initialAutoplay && videoEl.paused && (mode === "embed" || isLive)) {
          // 라이브는 muted autoplay 가 사실상 필수 — autoplay 정책 통과를 위해.
          videoEl.muted = true;
          try {
            await videoEl.play();
          } catch {
            // 두 번째 시도도 거부되면 PlayOverlay 가 사용자 액션 유도
          }
        }
      })
      .catch((err) => {
        captureIntentEvent("clip_player_engine_attach_failed", {
          funnel: "clip_consumption",
          clip_id: clip?.id ?? null,
          media_id: media?.id ?? null,
          live_public_id: live?.publicId ?? null,
          is_live: isLive,
          mode,
          reason: isExpectedMediaError(err) ? "expected_media_error" : "media_error",
          error_message: err instanceof Error ? err.message : String(err),
        });
        if (!isExpectedMediaError(err)) {
          toast.error(isLive ? "방송을 재생할 수 없습니다." : "영상을 재생할 수 없습니다.");
        }
      });
    return () => {
      cancelled = true;
      e.detach();
      setEngine(null);
    };
  }, [
    videoEl,
    src,
    isLive,
    isDirectMedia,
    clip?.id,
    clip?.mediaType,
    media?.id,
    initialAutoplay,
    mode,
    latencyMode,
    live,
  ]);

  // ── 화질 추적 ────────────────────────────────────────────────────────────
  const [qualities, setQualities] = useState<VideoQuality[]>([]);
  const [currentLevel, setCurrentLevel] = useState(-1);

  useEffect(() => {
    if (!engine?.onQualityChange) return;
    const unsubscribe = engine.onQualityChange((qs, level) => {
      setQualities(qs);
      setCurrentLevel(level);
    });
    return unsubscribe;
  }, [engine]);

  const handleSetQuality = useCallback(
    (level: number) => {
      captureIntentEvent("clip_player_quality_set", {
        funnel: "clip_consumption",
        clip_id: clip?.id ?? null,
        media_id: media?.id ?? null,
        live_public_id: live?.publicId ?? null,
        level,
        is_live: isLive,
      });
      engine?.setQuality?.(level);
    },
    [engine, clip?.id, media?.id, live?.publicId, isLive],
  );

  const handleSeekToLive = useCallback(() => {
    captureIntentEvent("clip_player_seek_to_live_submitted", {
      funnel: "clip_consumption",
      live_public_id: live?.publicId ?? null,
      latency_mode: latencyMode,
    });
    engine?.seekToLive?.();
  }, [engine, live?.publicId, latencyMode]);

  const handleStop = useCallback(() => {
    if (!isLive) return;
    captureIntentEvent("clip_player_live_stop_submitted", {
      funnel: "clip_consumption",
      live_public_id: live?.publicId ?? null,
      latency_mode: latencyMode,
    });
    engine?.stop?.();
    setLiveStopped(true);
  }, [isLive, engine, live?.publicId, latencyMode]);

  const handleResume = useCallback(() => {
    if (!isLive) return;
    captureIntentEvent("clip_player_live_resume_submitted", {
      funnel: "clip_consumption",
      live_public_id: live?.publicId ?? null,
      latency_mode: latencyMode,
    });
    engine?.start?.();
    setLiveStopped(false);
  }, [isLive, engine, live?.publicId, latencyMode]);

  const handleToggleLatency = useCallback(() => {
    captureIntentEvent("clip_player_latency_mode_changed", {
      funnel: "clip_consumption",
      live_public_id: live?.publicId ?? null,
      latency_mode_before: latencyMode,
      latency_mode_after: latencyMode === "low" ? "normal" : "low",
    });
    setLatencyMode((m) => (m === "low" ? "normal" : "low"));
  }, [live?.publicId, latencyMode]);

  // HlsEngine 이 onFatalError 옵션을 직접 받으므로 video.error 보조 추적은 제거.

  const state = usePlayerState(videoEl, containerEl);

  // 사용자가 바꾼 볼륨/음소거를 저장 (복원 완료 후에만 — 초기 동기화 값 덮어쓰기 방지)
  useEffect(() => {
    if (!volumeRestoredRef.current) return;
    setStoredVolume(state.volume);
    if (!isLive) setStoredMuted(state.muted);
  }, [state.volume, state.muted, isLive, setStoredVolume, setStoredMuted]);
  const controlsVisible = useAutoHideControls(containerEl, !state.playing);

  // 라이브는 무한 길이라 hasStarted 가 의미 다름 — 재생 시작 후 controls 정상 fade.
  const metaVisible = !state.hasStarted || controlsVisible;
  const controlBarVisible = state.hasStarted && controlsVisible;

  const togglePlay = useCallback(() => {
    if (!videoEl) return;
    captureIntentEvent("clip_player_toggle_play_submitted", {
      funnel: "clip_consumption",
      clip_id: clip?.id ?? null,
      media_id: media?.id ?? null,
      live_public_id: live?.publicId ?? null,
      is_live: isLive,
      paused_before: videoEl.paused,
      ended_before: videoEl.ended,
      current_time_seconds: Math.floor(videoEl.currentTime || 0),
    });
    if (isLive) {
      // 라이브 시청은 일시정지 자체를 허용하지 않는다 — 정지(Stop)/다시 입장 만 정식 흐름.
      // 이미 paused 상태면 무시 (재진입은 PlayOverlay 의 handleResume 가 처리).
      if (videoEl.paused) {
        videoEl.play().catch((err) => {
          if (!isExpectedMediaError(err)) {
            captureIntentEvent("clip_player_play_failed", {
              funnel: "clip_consumption",
              live_public_id: live?.publicId ?? null,
              reason: "play_error",
              error_message: err instanceof Error ? err.message : String(err),
            });
            toast.error("재생할 수 없습니다.");
          }
        });
      }
      return;
    }
    if (videoEl.paused || videoEl.ended) {
      videoEl.play().catch((err) => {
        if (!isExpectedMediaError(err)) {
          captureIntentEvent("clip_player_play_failed", {
            funnel: "clip_consumption",
            clip_id: clip?.id ?? null,
            media_id: media?.id ?? null,
            reason: "play_error",
            error_message: err instanceof Error ? err.message : String(err),
          });
          toast.error("재생할 수 없습니다.");
        }
      });
    } else {
      videoEl.pause();
    }
  }, [videoEl, isLive, clip?.id, media?.id, live?.publicId]);

  const seek = useCallback(
    (delta: number) => {
      if (!videoEl || isLive) return;
      videoEl.currentTime = Math.max(
        0,
        Math.min(videoEl.duration || 0, videoEl.currentTime + delta)
      );
      captureIntentEvent("clip_player_seek_relative", {
        funnel: "clip_consumption",
        clip_id: clip?.id ?? null,
        media_id: media?.id ?? null,
        delta_seconds: delta,
        current_time_seconds: Math.floor(videoEl.currentTime || 0),
      });
    },
    [videoEl, isLive, clip?.id, media?.id]
  );

  const seekAbsolute = useCallback(
    (t: number) => {
      if (!videoEl || isLive) return;
      videoEl.currentTime = Math.max(0, Math.min(videoEl.duration || 0, t));
      captureIntentEvent("clip_player_seek_absolute", {
        funnel: "clip_consumption",
        clip_id: clip?.id ?? null,
        media_id: media?.id ?? null,
        seek_time_seconds: Math.floor(t),
        duration_seconds: Math.floor(videoEl.duration || 0),
      });
    },
    [videoEl, isLive, clip?.id, media?.id]
  );

  const seekToFraction = useCallback(
    (frac: number) => {
      if (!videoEl || isLive) return;
      videoEl.currentTime = (videoEl.duration || 0) * Math.max(0, Math.min(1, frac));
      captureIntentEvent("clip_player_seek_fraction", {
        funnel: "clip_consumption",
        clip_id: clip?.id ?? null,
        media_id: media?.id ?? null,
        fraction: frac,
        duration_seconds: Math.floor(videoEl.duration || 0),
      });
    },
    [videoEl, isLive, clip?.id, media?.id]
  );

  const setVolumeValue = useCallback(
    (vol: number) => {
      if (!videoEl) return;
      videoEl.muted = false;
      videoEl.volume = Math.max(0, Math.min(1, vol));
      captureIntentEvent("clip_player_volume_set", {
        funnel: "clip_consumption",
        clip_id: clip?.id ?? null,
        media_id: media?.id ?? null,
        live_public_id: live?.publicId ?? null,
        volume: videoEl.volume,
      });
    },
    [videoEl, clip?.id, media?.id, live?.publicId]
  );

  const adjustVolume = useCallback(
    (delta: number) => {
      if (!videoEl) return;
      videoEl.muted = false;
      videoEl.volume = Math.max(0, Math.min(1, videoEl.volume + delta));
      captureIntentEvent("clip_player_volume_adjusted", {
        funnel: "clip_consumption",
        clip_id: clip?.id ?? null,
        media_id: media?.id ?? null,
        live_public_id: live?.publicId ?? null,
        delta,
        volume: videoEl.volume,
      });
    },
    [videoEl, clip?.id, media?.id, live?.publicId]
  );

  const toggleMute = useCallback(() => {
    if (!videoEl) return;
    captureIntentEvent("clip_player_mute_set", {
      funnel: "clip_consumption",
      clip_id: clip?.id ?? null,
      media_id: media?.id ?? null,
      live_public_id: live?.publicId ?? null,
      muted_before: videoEl.muted,
    });
    videoEl.muted = !videoEl.muted;
  }, [videoEl, clip?.id, media?.id, live?.publicId]);

  const setRate = useCallback(
    (r: number) => {
      if (!videoEl || isLive) return;
      videoEl.playbackRate = r;
      captureIntentEvent("clip_player_rate_set", {
        funnel: "clip_consumption",
        clip_id: clip?.id ?? null,
        media_id: media?.id ?? null,
        playback_rate: r,
      });
    },
    [videoEl, isLive, clip?.id, media?.id]
  );

  const togglePip = useCallback(async () => {
    if (!videoEl || !capabilities.pip) return;
    try {
      if (document.pictureInPictureElement === videoEl) {
        await document.exitPictureInPicture();
        captureIntentEvent("clip_player_pip_exited", {
          funnel: "clip_consumption",
          clip_id: clip?.id ?? null,
          media_id: media?.id ?? null,
          live_public_id: live?.publicId ?? null,
        });
      } else {
        await videoEl.requestPictureInPicture();
        captureIntentEvent("clip_player_pip_entered", {
          funnel: "clip_consumption",
          clip_id: clip?.id ?? null,
          media_id: media?.id ?? null,
          live_public_id: live?.publicId ?? null,
        });
      }
    } catch (err) {
      if (!isExpectedMediaError(err)) {
        captureIntentEvent("clip_player_pip_failed", {
          funnel: "clip_consumption",
          clip_id: clip?.id ?? null,
          media_id: media?.id ?? null,
          live_public_id: live?.publicId ?? null,
          reason: "api_error",
          error_message: err instanceof Error ? err.message : String(err),
        });
        toast.error("PIP 전환에 실패했습니다.");
      }
    }
  }, [videoEl, capabilities.pip, clip?.id, media?.id, live?.publicId]);

  const toggleFullscreen = useCallback(async () => {
    if (!containerEl || !capabilities.fullscreen) return;
    try {
      if (document.fullscreenElement === containerEl) {
        await document.exitFullscreen();
        captureIntentEvent("clip_player_fullscreen_exited", {
          funnel: "clip_consumption",
          clip_id: clip?.id ?? null,
          media_id: media?.id ?? null,
          live_public_id: live?.publicId ?? null,
        });
      } else {
        await containerEl.requestFullscreen();
        captureIntentEvent("clip_player_fullscreen_entered", {
          funnel: "clip_consumption",
          clip_id: clip?.id ?? null,
          media_id: media?.id ?? null,
          live_public_id: live?.publicId ?? null,
        });
      }
    } catch (err) {
      if (!isExpectedMediaError(err)) {
        captureIntentEvent("clip_player_fullscreen_failed", {
          funnel: "clip_consumption",
          clip_id: clip?.id ?? null,
          media_id: media?.id ?? null,
          live_public_id: live?.publicId ?? null,
          reason: "api_error",
          error_message: err instanceof Error ? err.message : String(err),
        });
        toast.error("전체화면 전환에 실패했습니다.");
      }
    }
  }, [containerEl, capabilities.fullscreen, clip?.id, media?.id, live?.publicId]);

  const publicUrl = useMemo(() => {
    if (isLive) {
      const webPath = live!.channel.channelWebPath ?? "";
      return `${BASE_URL}/channel/${encodeURIComponent(webPath)}/live/${encodeURIComponent(live!.publicId)}`;
    }
    if (isDirectMedia) {
      return media.publicUrl ?? media.src;
    }
    return `${BASE_URL}/clip/${clip!.id}`;
  }, [isLive, isDirectMedia, live, media, clip]);

  const copyPublicUrl = useCallback(async () => {
    const ok = await copyToClipboard(publicUrl);
    captureIntentEvent(ok ? "clip_player_public_url_copied" : "clip_player_public_url_copy_failed", {
      funnel: "clip_sharing",
      clip_id: clip?.id ?? null,
      media_id: media?.id ?? null,
      live_public_id: live?.publicId ?? null,
      is_live: isLive,
      mode,
    });
    if (ok) toast.success("링크가 복사되었습니다");
    else toast.error("링크 복사에 실패했습니다");
  }, [publicUrl, clip?.id, media?.id, live?.publicId, isLive, mode]);

  const copyEmbed = useCallback(async () => {
    if (!isClip) return;
    const ok = await copyToClipboard(buildEmbedCode(clip!.id));
    captureIntentEvent(ok ? "clip_player_embed_code_copied" : "clip_player_embed_code_copy_failed", {
      funnel: "clip_sharing",
      clip_id: clip!.id,
      mode,
    });
    if (ok) toast.success("임베드 코드가 복사되었습니다");
    else toast.error("임베드 코드 복사에 실패했습니다");
  }, [isClip, clip, mode]);

  const openShare = useCallback(() => {
    captureIntentEvent("clip_player_share_toggled", {
      funnel: "clip_sharing",
      clip_id: clip?.id ?? null,
      media_id: media?.id ?? null,
      live_public_id: live?.publicId ?? null,
      open: !sharePopOpen,
    });
    setSharePopOpen((v) => !v);
  }, [clip?.id, media?.id, live?.publicId, sharePopOpen]);

  const actions = useMemo(
    () => ({
      togglePlay,
      seek,
      seekToFraction,
      adjustVolume,
      toggleMute,
      toggleFullscreen,
      togglePip,
    }),
    [togglePlay, seek, seekToFraction, adjustVolume, toggleMute, toggleFullscreen, togglePip]
  );

  useKeyboardShortcuts(containerEl, actions, Boolean(src), {
    seekDisabled: isLive,
    togglePlayDisabled: isLive,
  });

  const openContextMenuAt = useCallback(
    (clientX: number, clientY: number) => {
      if (!containerEl) return;
      const rect = containerEl.getBoundingClientRect();
      setContextMenu({
        x: clientX - rect.left,
        y: clientY - rect.top,
        w: rect.width,
        h: rect.height,
      });
    },
    [containerEl]
  );

  const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    openContextMenuAt(e.clientX, e.clientY);
  };

  const onKeyDownContainer = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") {
      e.preventDefault();
      if (!containerEl) return;
      const rect = containerEl.getBoundingClientRect();
      openContextMenuAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }
  };

  const contextMenuItems: ContextMenuItem[] = useMemo(() => {
    const items: ContextMenuItem[] = [
      {
        label: state.playing ? "일시정지" : "재생",
        onClick: togglePlay,
      },
    ];
    if (!isLive) {
      items.push({
        label: `재생 속도 (${state.playbackRate}x → ${
          state.playbackRate >= 2 ? "1" : (state.playbackRate + 0.25).toString()
        }x)`,
        onClick: () => setRate(state.playbackRate >= 2 ? 1 : state.playbackRate + 0.25),
      });
    }
    items.push({
      label: isLive
        ? "라이브 URL 복사"
        : isDirectMedia
          ? "영상 URL 복사"
          : "클립 URL 복사",
      onClick: copyPublicUrl,
    });
    if (isClip) {
      items.push({
        label: "임베드 코드 복사",
        onClick: copyEmbed,
      });
    }
    items.push({
      label: "단축키 안내",
      onClick: () => {
        toast.info(
          isLive
            ? "Space/k 재생 · ↑/↓ 볼륨 · m 음소거 · f 전체화면 · p PIP"
            : "Space/k 재생 · ←/j -5초 · →/l +5초 · ↑/↓ 볼륨 · m 음소거 · f 전체화면 · p PIP · 0-9 진행률"
        );
      },
    });
    if (mode === "embed" && !isLive) {
      items.push({
        label: isDirectMedia ? "원문에서 보기" : "멜로밍에서 보기",
        onClick: () => {
          window.open(publicUrl, "_blank", "noopener,noreferrer");
        },
      });
    }
    return items;
  }, [
    copyEmbed,
    copyPublicUrl,
    isClip,
    isDirectMedia,
    isLive,
    mode,
    publicUrl,
    setRate,
    state.playbackRate,
    state.playing,
    togglePlay,
  ]);

  useEffect(() => {
    if (state.ended) onEnded?.();
  }, [state.ended, onEnded]);

  // ── primaryChannel + 메타 분기 ───────────────────────────────────────────
  const primaryChannel: PlayerChannelInfo | undefined = isLive
    ? live!.channel
    : isDirectMedia
      ? media.channel
      : clip!.channels.find((c) => c.isPrimary) ?? clip!.channels[0];

  const metaTitle = isLive
    ? live!.title
    : isDirectMedia
      ? media.title
      : clip!.title;
  const metaCreatedAt = isLive
    ? undefined
    : isDirectMedia
      ? media.createdAt
      : clip!.createdAt;
  const metaViewCount =
    isLive || isDirectMedia ? undefined : clip!.stat?.viewCount;

  // embed 모드: 호스트 iframe 의 width/height 를 그대로 채움. 외부에서 16:9 가 아닌
  // 비율로 임베드해도 컨트롤이 화면에 맞게 들어간다 (YouTube/Vimeo 동일 패턴).
  // inline 모드: aspect-video 로 16:9 유지.
  const containerSize =
    mode === "embed" ? "h-full w-full" : "aspect-video w-full";

  // ── 로딩 / 에러 게이트 ───────────────────────────────────────────────────
  if (isLive && liveSrcError) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className={cn(
          "flex flex-col items-center justify-center gap-3 overflow-hidden rounded-lg bg-black text-white",
          containerSize
        )}
      >
        <p className="text-sm">{liveSrcError}</p>
      </div>
    );
  }
  if (isLive && !liveSrc) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "flex items-center justify-center overflow-hidden rounded-lg bg-black text-white/70",
          containerSize
        )}
      >
        <p className="text-sm">방송 준비 중…</p>
      </div>
    );
  }

  if (!isLive && isSelfHostedDirect && playUrlQuery.isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "flex items-center justify-center overflow-hidden rounded-lg bg-muted",
          containerSize
        )}
      >
        <p className="text-sm text-muted-foreground">영상 준비 중…</p>
      </div>
    );
  }
  if (!isLive && isSelfHostedDirect && (playUrlQuery.error || !playUrlQuery.data?.url)) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className={cn(
          "flex flex-col items-center justify-center gap-3 overflow-hidden rounded-lg bg-muted",
          containerSize
        )}
      >
        <p className="text-sm text-muted-foreground">영상을 불러올 수 없습니다.</p>
        <button
          type="button"
          onClick={() => {
            captureIntentEvent("clip_player_play_url_retry_clicked", {
              funnel: "clip_consumption",
              clip_id: clip?.id ?? null,
              reason: playUrlQuery.error ? "query_error" : "missing_url",
            });
            playUrlQuery.refetch();
          }}
          className="rounded border border-muted-foreground/30 px-3 py-1 text-xs text-muted-foreground hover:bg-muted-foreground/10"
        >
          다시 시도
        </button>
      </div>
    );
  }

  return (
    <div
      ref={setContainerEl}
      role="region"
      aria-label={
        isLive
          ? "Meloming Live 플레이어"
          : isDirectMedia
            ? "Meloming 미디어 플레이어"
            : "Meloming Clip 플레이어"
      }
      tabIndex={0}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDownContainer}
      onClick={(e) => {
        // 라이브 모드는 화면 클릭 일시정지 차단 — 정지는 ControlBar Stop 버튼만 가능.
        if (isLive) return;
        if (e.target === containerEl || e.target === videoEl) {
          togglePlay();
        }
      }}
      className={cn(
        "relative overflow-hidden bg-black outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50",
        mode === "embed" ? "rounded-none" : "rounded-lg",
        containerSize,
        state.fullscreen && "rounded-none"
      )}
    >
      <video
        ref={setVideoEl}
        poster={
          isLive
            ? undefined
            : isDirectMedia
              ? (media.poster ?? undefined)
              : clip!.thumbnailUrl
        }
        preload="metadata"
        playsInline
        controlsList="nodownload"
        className={cn(
          "absolute inset-0 size-full",
          (mode === "embed" || isDirectMedia) && "object-contain"
        )}
      >
        영상을 재생할 수 없는 브라우저입니다.
      </video>

      {showMetaOverlay ? (
        <MetaOverlay
          title={metaTitle}
          primaryChannel={primaryChannel}
          viewCount={metaViewCount}
          createdAt={metaCreatedAt}
          viewerCount={isLive ? live!.viewerCount : undefined}
          isLive={isLive}
          visible={metaVisible}
          publicUrl={publicUrl}
          publicUrlLabel={isDirectMedia ? "게시물로 이동" : undefined}
          onShare={openShare}
        />
      ) : null}

      <PlayOverlay
        visible={
          isLive
            ? liveStopped
            : !state.playing && (!state.hasStarted || state.ended)
        }
        replay={!isLive && state.ended}
        onPlay={() => {
          if (isLive) {
            handleResume();
            return;
          }
          if (state.ended && videoEl) {
            videoEl.currentTime = 0;
          }
          togglePlay();
        }}
      />

      <ControlBar
        state={state}
        visible={controlBarVisible}
        pipSupported={capabilities.pip}
        fullscreenSupported={capabilities.fullscreen}
        isLive={isLive}
        qualities={qualities}
        currentLevel={currentLevel}
        onSetQuality={handleSetQuality}
        onStop={handleStop}
        onSeekToLive={handleSeekToLive}
        latencyMode={latencyMode}
        onToggleLatency={handleToggleLatency}
        onTogglePlay={togglePlay}
        onSeek={seekAbsolute}
        onVolume={setVolumeValue}
        onToggleMute={toggleMute}
        onRate={setRate}
        onTogglePip={togglePip}
        onToggleFullscreen={toggleFullscreen}
      />

      <SharePopover
        visible={sharePopOpen}
        onClose={() => setSharePopOpen(false)}
        onCopyLink={copyPublicUrl}
        onCopyEmbed={isClip ? copyEmbed : undefined}
      />

      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          containerWidth={contextMenu.w}
          containerHeight={contextMenu.h}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
    </div>
  );
}
