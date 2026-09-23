"use client";

import { useEffect, useState } from "react";

export type PlayerPhase = "idle" | "playing" | "paused" | "ended";

export interface PlayerState {
  phase: PlayerPhase;
  playing: boolean;
  ended: boolean;
  hasStarted: boolean;
  currentTime: number;
  duration: number;
  buffered: number;
  volume: number;
  muted: boolean;
  playbackRate: number;
  pip: boolean;
  fullscreen: boolean;
}

const INITIAL: PlayerState = {
  phase: "idle",
  playing: false,
  ended: false,
  hasStarted: false,
  currentTime: 0,
  duration: 0,
  buffered: 0,
  volume: 1,
  muted: false,
  playbackRate: 1,
  pip: false,
  fullscreen: false,
};

function withPhase(s: PlayerState, phase: PlayerPhase): PlayerState {
  return {
    ...s,
    phase,
    playing: phase === "playing",
    ended: phase === "ended",
    hasStarted: s.hasStarted || phase === "playing",
  };
}

/**
 * video / container 는 callback ref(useState) 로 받는다. 첫 mount 후
 * element 가 set 되면 effect 가 자동으로 재실행되어 listener 가 attach 된다.
 * useRef 로 받으면 ref.current 변경이 deps 를 트리거하지 않아 첫 render 때
 * null 인 경우 listener 가 영원히 미바인딩 상태가 된다.
 */
export function usePlayerState(
  video: HTMLVideoElement | null,
  container: HTMLDivElement | null
): PlayerState {
  const [state, setState] = useState<PlayerState>(INITIAL);

  useEffect(() => {
    if (!video) return;

    const setPhase = (phase: PlayerPhase) => setState((s) => withPhase(s, phase));
    const patch = (p: Partial<PlayerState>) => setState((s) => ({ ...s, ...p }));

    const onPlay = () => setPhase("playing");
    const onPause = () => setPhase(video.ended ? "ended" : "paused");
    const onEnded = () => setPhase("ended");
    const onTimeUpdate = () => patch({ currentTime: video.currentTime });
    const onLoadedMetadata = () => patch({ duration: video.duration });
    const onProgress = () => {
      if (video.buffered.length > 0) {
        patch({ buffered: video.buffered.end(video.buffered.length - 1) });
      }
    };
    const onVolumeChange = () => patch({ volume: video.volume, muted: video.muted });
    const onRateChange = () => patch({ playbackRate: video.playbackRate });
    const onEnterPip = () => patch({ pip: true });
    const onLeavePip = () => patch({ pip: false });

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("progress", onProgress);
    video.addEventListener("volumechange", onVolumeChange);
    video.addEventListener("ratechange", onRateChange);
    video.addEventListener("enterpictureinpicture", onEnterPip);
    video.addEventListener("leavepictureinpicture", onLeavePip);

    // mount 시점에 이미 메타 로딩됐을 수 있어 1회 sync (HMR / engine attach race 대응)
    if (!Number.isNaN(video.duration) && video.duration > 0) {
      patch({ duration: video.duration });
    }
    patch({ volume: video.volume, muted: video.muted, playbackRate: video.playbackRate });

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("progress", onProgress);
      video.removeEventListener("volumechange", onVolumeChange);
      video.removeEventListener("ratechange", onRateChange);
      video.removeEventListener("enterpictureinpicture", onEnterPip);
      video.removeEventListener("leavepictureinpicture", onLeavePip);
    };
  }, [video]);

  useEffect(() => {
    if (!container) return;
    const onFsChange = () =>
      setState((s) => ({
        ...s,
        fullscreen: document.fullscreenElement === container,
      }));
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, [container]);

  return state;
}
