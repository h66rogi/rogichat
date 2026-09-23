"use client";

import { useEffect, useRef, useState } from "react";
import {
  Pause,
  Play,
  Square,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  PictureInPicture2,
  Gauge,
  Settings,
  Zap,
} from "lucide-react";
import { cn } from "@/meloming/shared/lib/utils";
import type { PlayerState } from "../hooks/use-player-state";
import type { VideoQuality } from "../engine/media-engine";
import type { HlsLatencyMode } from "../engine/hls-engine";
import { captureIntentEvent } from "@/meloming/shared/analytics/intentional-events";

interface ControlBarProps {
  state: PlayerState;
  visible: boolean;
  pipSupported: boolean;
  fullscreenSupported: boolean;
  /** 라이브 모드 — progress bar / time display / speed picker 숨김 (seek/duration 의미 X) */
  isLive?: boolean;
  /** 가용 화질 목록. 2개 이상일 때만 화질 picker 노출. */
  qualities?: VideoQuality[];
  /** 현재 선택 level. -1 = ABR(자동). */
  currentLevel?: number;
  /** 화질 변경 — -1 전달 시 ABR(자동) 으로 복귀. */
  onSetQuality?(levelIndex: number): void;
  /** 라이브 정지 — engine detach 까지 가는 액션. 클립 모드에서는 무시. */
  onStop?(): void;
  /** 라이브 latest edge 로 점프. */
  onSeekToLive?(): void;
  /** 라이브 지연 모드. 라이브에서만 의미. */
  latencyMode?: HlsLatencyMode;
  /** 지연 모드 토글 — low ↔ normal */
  onToggleLatency?(): void;
  onTogglePlay(): void;
  onSeek(t: number): void;
  onVolume(v: number): void;
  onToggleMute(): void;
  onRate(r: number): void;
  onTogglePip(): void;
  onToggleFullscreen(): void;
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  const h = Math.floor(m / 60);
  if (h > 0) {
    return `${h}:${String(m % 60).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function ControlBar({
  state,
  visible,
  pipSupported,
  fullscreenSupported,
  isLive = false,
  qualities,
  currentLevel = -1,
  onSetQuality,
  onStop,
  onSeekToLive,
  latencyMode = "low",
  onToggleLatency,
  onTogglePlay,
  onSeek,
  onVolume,
  onToggleMute,
  onRate,
  onTogglePip,
  onToggleFullscreen,
}: ControlBarProps) {
  const [speedOpen, setSpeedOpen] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const speedRef = useRef<HTMLDivElement | null>(null);
  const volumeRef = useRef<HTMLDivElement | null>(null);
  const qualityRef = useRef<HTMLDivElement | null>(null);

  // 단일 variant 라도 사용자가 "자동" 상태인지 강제 level 인지 토글 가능하도록 노출.
  const qualityPickerVisible = !!(qualities && qualities.length >= 1 && onSetQuality);
  const currentLevelLabel =
    currentLevel === -1
      ? "자동"
      : qualities?.find((q) => q.level === currentLevel)?.height
        ? `${qualities.find((q) => q.level === currentLevel)!.height}p`
        : "자동";

  useEffect(() => {
    if (!speedOpen && !volumeOpen && !qualityOpen) return;
    const onDown = (e: MouseEvent) => {
      if (speedOpen && speedRef.current && !speedRef.current.contains(e.target as Node)) {
        setSpeedOpen(false);
      }
      if (volumeOpen && volumeRef.current && !volumeRef.current.contains(e.target as Node)) {
        setVolumeOpen(false);
      }
      if (qualityOpen && qualityRef.current && !qualityRef.current.contains(e.target as Node)) {
        setQualityOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [speedOpen, volumeOpen, qualityOpen]);

  const onTimelineMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    setHoverTime(Math.max(0, Math.min(1, frac)) * state.duration);
  };
  const onTimelineLeave = () => setHoverTime(null);
  const onTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    onSeek(Math.max(0, Math.min(1, frac)) * state.duration);
  };
  const onTimelineKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const dur = state.duration || 0;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onSeek(Math.max(0, state.currentTime - 5));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onSeek(Math.min(dur, state.currentTime + 5));
    } else if (e.key === "Home") {
      e.preventDefault();
      onSeek(0);
    } else if (e.key === "End") {
      e.preventDefault();
      onSeek(dur);
    } else if (e.key === "PageDown") {
      e.preventDefault();
      onSeek(Math.max(0, state.currentTime - dur * 0.1));
    } else if (e.key === "PageUp") {
      e.preventDefault();
      onSeek(Math.min(dur, state.currentTime + dur * 0.1));
    }
  };

  const progressPct = state.duration > 0 ? (state.currentTime / state.duration) * 100 : 0;
  const bufferPct = state.duration > 0 ? (state.buffered / state.duration) * 100 : 0;

  return (
    <div
      aria-hidden={!visible}
      className={cn(
        "absolute inset-x-0 bottom-0 z-20 flex flex-col gap-1 px-3 pb-2",
        isLive ? "pt-3" : "pt-6",
        "bg-gradient-to-t from-black/80 via-black/40 to-transparent motion-safe:transition-opacity motion-safe:duration-200",
        visible ? "opacity-100" : "opacity-0 pointer-events-none"
      )}
    >
      {!isLive && (
        <div
          role="slider"
          tabIndex={visible ? 0 : -1}
          aria-label="진행"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, Math.floor(state.duration))}
          aria-valuenow={Math.floor(state.currentTime)}
          aria-valuetext={`${formatTime(state.currentTime)} / ${formatTime(state.duration)}`}
          className="group relative h-3 cursor-pointer focus-visible:outline focus-visible:outline-1 focus-visible:outline-indigo-400 rounded"
          onMouseMove={onTimelineMove}
          onMouseLeave={onTimelineLeave}
          onClick={(event) => {
            captureIntentEvent("clip_player_timeline_clicked", {
              funnel: "clip_consumption",
              current_time_seconds: Math.floor(state.currentTime),
              duration_seconds: Math.floor(state.duration),
              progress_percent: Math.round(progressPct),
            });
            onTimelineClick(event);
          }}
          onKeyDown={onTimelineKey}
        >
          <div className="absolute inset-y-1/2 -translate-y-1/2 h-1 w-full rounded-full bg-white/20" />
          <div
            className="absolute inset-y-1/2 -translate-y-1/2 h-1 rounded-full bg-white/40"
            style={{ width: `${bufferPct}%` }}
          />
          <div
            className="absolute inset-y-1/2 -translate-y-1/2 h-1 rounded-full bg-indigo-500"
            style={{ width: `${progressPct}%` }}
          />
          {hoverTime !== null && state.duration > 0 ? (
            <div
              className="pointer-events-none absolute -top-7 -translate-x-1/2 rounded bg-black/90 px-1.5 py-0.5 text-[10px] text-white"
              style={{ left: `${(hoverTime / state.duration) * 100}%` }}
            >
              {formatTime(hoverTime)}
            </div>
          ) : null}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 text-white [&_svg]:drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
        <div className="flex items-center gap-1">
          {isLive ? (
            <button
              type="button"
              tabIndex={visible ? 0 : -1}
              onClick={() => {
                captureIntentEvent("clip_player_live_stop_clicked", {
                  funnel: "clip_consumption",
                  is_live: true,
                });
                onStop?.();
              }}
              aria-label="방송 시청 정지"
              className="inline-flex size-11 items-center justify-center rounded hover:bg-white/10 focus:bg-white/10 focus:outline-none"
            >
              <Square className="size-5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              tabIndex={visible ? 0 : -1}
              onClick={() => {
                captureIntentEvent("clip_player_play_toggled", {
                  funnel: "clip_consumption",
                  playing_before: state.playing,
                  current_time_seconds: Math.floor(state.currentTime),
                  duration_seconds: Math.floor(state.duration),
                });
                onTogglePlay();
              }}
              aria-label={state.playing ? "일시정지" : "재생"}
              aria-pressed={state.playing}
              className="inline-flex size-11 items-center justify-center rounded hover:bg-white/10 focus:bg-white/10 focus:outline-none"
            >
              {state.playing ? (
                <Pause className="size-5" />
              ) : (
                <Play className="size-5 translate-x-0.5 fill-current" />
              )}
            </button>
          )}
          <div ref={volumeRef} className="group/vol relative flex items-center gap-1">
            <button
              type="button"
              tabIndex={visible ? 0 : -1}
              onClick={() => {
                captureIntentEvent("clip_player_mute_toggled", {
                  funnel: "clip_consumption",
                  muted_before: state.muted,
                  volume: state.volume,
                });
                onToggleMute();
                setVolumeOpen((v) => !v);
              }}
              aria-label={state.muted ? "음소거 해제" : "음소거"}
              aria-pressed={state.muted}
              aria-haspopup="true"
              aria-expanded={volumeOpen}
              className="inline-flex size-11 items-center justify-center rounded hover:bg-white/10 focus:bg-white/10 focus:outline-none"
            >
              {state.muted || state.volume === 0 ? (
                <VolumeX className="size-5" />
              ) : (
                <Volume2 className="size-5" />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={state.muted ? 0 : state.volume}
              onChange={(e) => {
                const nextVolume = Number(e.target.value);
                captureIntentEvent("clip_player_volume_changed", {
                  funnel: "clip_consumption",
                  previous_volume: state.volume,
                  volume: nextVolume,
                  muted_before: state.muted,
                });
                onVolume(nextVolume);
              }}
              aria-label="볼륨"
              tabIndex={visible ? 0 : -1}
              className={cn(
                "h-2 w-24 accent-indigo-500",
                "md:hidden md:group-hover/vol:block md:group-focus-within/vol:block",
                volumeOpen ? "block" : "hidden md:block"
              )}
            />
          </div>
          {isLive ? (
            <div className="ml-1 flex items-center gap-1">
              <button
                type="button"
                tabIndex={visible ? 0 : -1}
                onClick={() => {
                  captureIntentEvent("clip_player_seek_to_live_clicked", {
                    funnel: "clip_consumption",
                    latency_mode: latencyMode,
                  });
                  onSeekToLive?.();
                }}
                aria-label="최신으로 이동"
                title="최신으로 이동"
                className="inline-flex h-9 items-center gap-1.5 rounded bg-red-600 px-2.5 text-[11px] font-bold uppercase text-white drop-shadow transition hover:bg-red-700 focus:bg-red-700 focus:outline-none"
              >
                <span className="size-1.5 animate-pulse rounded-full bg-white" />
                LIVE
              </button>
              {onToggleLatency && (
                <button
                  type="button"
                  tabIndex={visible ? 0 : -1}
                  onClick={() => {
                    captureIntentEvent("clip_player_latency_toggled", {
                      funnel: "clip_consumption",
                      latency_mode_before: latencyMode,
                    });
                    onToggleLatency?.();
                  }}
                  aria-label={
                    latencyMode === "low"
                      ? "지연 모드: 저지연 (클릭해서 표준으로)"
                      : "지연 모드: 표준 (클릭해서 저지연으로)"
                  }
                  title={
                    latencyMode === "low"
                      ? "저지연 모드 (~2-4초). 클릭하면 표준으로 변경"
                      : "표준 모드 (~12-15초, 안정성). 클릭하면 저지연으로 변경"
                  }
                  className={cn(
                    "inline-flex h-9 items-center gap-1 rounded px-2 text-[10px] font-semibold uppercase drop-shadow transition focus:outline-none",
                    latencyMode === "low"
                      ? "bg-emerald-600/80 text-white hover:bg-emerald-600 focus:bg-emerald-600"
                      : "bg-zinc-700/70 text-zinc-200 hover:bg-zinc-700 focus:bg-zinc-700",
                  )}
                >
                  <Zap className="size-3" />
                  {latencyMode === "low" ? "저지연" : "표준"}
                </button>
              )}
            </div>
          ) : (
            <div className="ml-1 text-xs font-medium tabular-nums drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
              {formatTime(state.currentTime)} / {formatTime(state.duration)}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!isLive && (
            <div ref={speedRef} className="relative">
              <button
                type="button"
                tabIndex={visible ? 0 : -1}
                onClick={() => {
                  captureIntentEvent("clip_player_speed_menu_toggled", {
                    funnel: "clip_consumption",
                    open: !speedOpen,
                    playback_rate: state.playbackRate,
                  });
                  setSpeedOpen((v) => !v);
                }}
                aria-label={`재생 속도 ${state.playbackRate}배`}
                aria-haspopup="menu"
                aria-expanded={speedOpen}
                className="inline-flex h-11 items-center gap-1 rounded px-2 hover:bg-white/10 focus:bg-white/10 focus:outline-none"
              >
                <Gauge className="size-4 drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]" />
                <span className="text-xs font-semibold tabular-nums drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
                  {state.playbackRate}x
                </span>
              </button>
              {speedOpen ? (
                <div
                  role="menu"
                  aria-label="재생 속도"
                  className="absolute bottom-full right-0 mb-2 min-w-[88px] overflow-hidden rounded-md border border-white/10 bg-black/90 backdrop-blur-md"
                >
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      role="menuitemradio"
                      aria-checked={state.playbackRate === s}
                      onClick={() => {
                        captureIntentEvent("clip_player_speed_selected", {
                          funnel: "clip_consumption",
                          previous_playback_rate: state.playbackRate,
                          playback_rate: s,
                        });
                        onRate(s);
                        setSpeedOpen(false);
                      }}
                      className={cn(
                        "block w-full px-3 py-2 text-left text-xs hover:bg-white/10 focus:bg-white/10 focus:outline-none",
                        state.playbackRate === s && "text-indigo-300"
                      )}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}
          {qualityPickerVisible && (
            <div ref={qualityRef} className="relative">
              <button
                type="button"
                tabIndex={visible ? 0 : -1}
                onClick={() => {
                  captureIntentEvent("clip_player_quality_menu_toggled", {
                    funnel: "clip_consumption",
                    open: !qualityOpen,
                    current_level: currentLevel,
                    current_level_label: currentLevelLabel,
                  });
                  setQualityOpen((v) => !v);
                }}
                aria-label={`화질 ${currentLevelLabel}`}
                aria-haspopup="menu"
                aria-expanded={qualityOpen}
                className="inline-flex h-11 items-center gap-1 rounded px-2 hover:bg-white/10 focus:bg-white/10 focus:outline-none"
              >
                <Settings className="size-4 drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]" />
                <span className="text-xs font-semibold tabular-nums drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
                  {currentLevelLabel}
                </span>
              </button>
              {qualityOpen ? (
                <div
                  role="menu"
                  aria-label="화질"
                  className="absolute bottom-full right-0 mb-2 min-w-[100px] overflow-hidden rounded-md border border-white/10 bg-black/90 backdrop-blur-md"
                >
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={currentLevel === -1}
                    onClick={() => {
                      captureIntentEvent("clip_player_quality_selected", {
                        funnel: "clip_consumption",
                        previous_level: currentLevel,
                        level: -1,
                        level_label: "자동",
                      });
                      onSetQuality?.(-1);
                      setQualityOpen(false);
                    }}
                    className={cn(
                      "block w-full px-3 py-2 text-left text-xs hover:bg-white/10 focus:bg-white/10 focus:outline-none",
                      currentLevel === -1 && "text-indigo-300",
                    )}
                  >
                    자동
                  </button>
                  {[...(qualities ?? [])]
                    .sort((a, b) => b.height - a.height)
                    .map((q) => (
                      <button
                        key={q.level}
                        type="button"
                        role="menuitemradio"
                        aria-checked={currentLevel === q.level}
                        onClick={() => {
                          captureIntentEvent("clip_player_quality_selected", {
                            funnel: "clip_consumption",
                            previous_level: currentLevel,
                            level: q.level,
                            level_label: `${q.height}p`,
                          });
                          onSetQuality?.(q.level);
                          setQualityOpen(false);
                        }}
                        className={cn(
                          "block w-full px-3 py-2 text-left text-xs hover:bg-white/10 focus:bg-white/10 focus:outline-none",
                          currentLevel === q.level && "text-indigo-300",
                        )}
                      >
                        {q.height}p
                      </button>
                    ))}
                </div>
              ) : null}
            </div>
          )}
          <button
            type="button"
            tabIndex={visible && pipSupported ? 0 : -1}
            onClick={() => {
              captureIntentEvent("clip_player_pip_toggled", {
                funnel: "clip_consumption",
                pip_before: state.pip,
                pip_supported: pipSupported,
              });
              onTogglePip();
            }}
            aria-label="PIP"
            aria-pressed={state.pip}
            aria-hidden={!pipSupported}
            disabled={!pipSupported}
            className={cn(
              "inline-flex size-11 items-center justify-center rounded hover:bg-white/10 focus:bg-white/10 focus:outline-none disabled:pointer-events-none",
              !pipSupported && "invisible",
            )}
          >
            <PictureInPicture2 className="size-4" />
          </button>
          <button
            type="button"
            tabIndex={visible && fullscreenSupported ? 0 : -1}
            onClick={() => {
              captureIntentEvent("clip_player_fullscreen_toggled", {
                funnel: "clip_consumption",
                fullscreen_before: state.fullscreen,
                fullscreen_supported: fullscreenSupported,
              });
              onToggleFullscreen();
            }}
            aria-label="전체화면"
            aria-pressed={state.fullscreen}
            aria-hidden={!fullscreenSupported}
            disabled={!fullscreenSupported}
            className={cn(
              "inline-flex size-11 items-center justify-center rounded hover:bg-white/10 focus:bg-white/10 focus:outline-none disabled:pointer-events-none",
              !fullscreenSupported && "invisible",
            )}
          >
            {state.fullscreen ? (
              <Minimize className="size-4" />
            ) : (
              <Maximize className="size-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
