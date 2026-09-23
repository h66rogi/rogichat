"use client";

import { useEffect } from "react";

interface Actions {
  togglePlay(): void;
  seek(deltaSec: number): void;
  seekToFraction(frac: number): void;
  adjustVolume(delta: number): void;
  toggleMute(): void;
  toggleFullscreen(): void;
  togglePip(): void;
}

/**
 * 단축키 디스패치. IME(한글/일본어/중국어) 합성 결과인 `event.key` 가 아니라
 * 물리 키 위치를 나타내는 `event.code` 를 사용한다 — 한글 IME 가 켜져 있어도
 * KeyM 은 `event.code === "KeyM"` 이라 정상 동작 (event.key 는 "ㅡ" 가 됨).
 * YouTube / Vimeo / Spotify Web Player 등이 동일 패턴을 쓴다.
 *
 * 함께 적용한 가드:
 * - IME 합성 중(isComposing) 이면 무시 — input/textarea 가 아니므로 거의 발생
 *   하지 않지만 일부 IME 가 컨테이너에 합성 시작을 보낼 수 있어 방어.
 * - Ctrl/Meta/Alt 동반 시 무시 — 브라우저 단축키(Ctrl+K 등) 와 충돌 차단.
 * - 입력 가능한 요소(input/textarea/contentEditable) 에 포커스가 있으면 무시.
 */
/**
 * options.seekDisabled — 라이브 스트림처럼 seek 가 의미 없는 컨텍스트에서 true.
 *   true 면 ArrowLeft / ArrowRight / KeyJ / KeyL / 0-9 키는 preventDefault 도 하지 않고
 *   그냥 네이티브 동작을 허용한다 (페이지 navigation 등).
 *
 * options.togglePlayDisabled — 라이브 시청 컨텍스트에서 일시정지 자체를 차단할 때 true.
 *   Space / KeyK 키가 native default 유지 (스크롤 등).
 */
export function useKeyboardShortcuts(
  container: HTMLDivElement | null,
  actions: Actions,
  enabled: boolean = true,
  options: { seekDisabled?: boolean; togglePlayDisabled?: boolean } = {},
) {
  const seekDisabled = options.seekDisabled === true;
  const togglePlayDisabled = options.togglePlayDisabled === true;

  useEffect(() => {
    if (!enabled || !container) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) {
          return;
        }
      }

      switch (e.code) {
        case "Space":
        case "KeyK":
          if (togglePlayDisabled) return;
          e.preventDefault();
          actions.togglePlay();
          return;
        case "ArrowLeft":
        case "KeyJ":
          if (seekDisabled) return;
          e.preventDefault();
          actions.seek(-5);
          return;
        case "ArrowRight":
        case "KeyL":
          if (seekDisabled) return;
          e.preventDefault();
          actions.seek(5);
          return;
        case "ArrowUp":
          e.preventDefault();
          actions.adjustVolume(0.1);
          return;
        case "ArrowDown":
          e.preventDefault();
          actions.adjustVolume(-0.1);
          return;
        case "KeyM":
          e.preventDefault();
          actions.toggleMute();
          return;
        case "KeyF":
          e.preventDefault();
          actions.toggleFullscreen();
          return;
        case "KeyP":
          e.preventDefault();
          actions.togglePip();
          return;
      }

      // 0-9 진행률 jump — main row (Digit0..Digit9) 와 numpad (Numpad0..Numpad9) 모두.
      // 숫자는 IME 영향 안 받지만 일관성을 위해 동일하게 code 기반.
      if (seekDisabled) return;
      let digit: number | null = null;
      if (e.code.startsWith("Digit")) {
        digit = Number(e.code.slice(5));
      } else if (e.code.startsWith("Numpad") && e.code.length === 7) {
        const n = Number(e.code.slice(6));
        if (!Number.isNaN(n)) digit = n;
      }
      if (digit !== null && digit >= 0 && digit <= 9) {
        e.preventDefault();
        actions.seekToFraction(digit / 10);
      }
    };

    container.addEventListener("keydown", onKey);
    return () => container.removeEventListener("keydown", onKey);
  }, [container, actions, enabled, seekDisabled, togglePlayDisabled]);
}
