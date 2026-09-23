"use client";

import { useEffect, useState } from "react";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * container 는 callback ref(useState) 로 받는다. element mount 시
 * effect 가 자동 재실행되어 listener 가 attach 된다.
 */
export function useAutoHideControls(
  container: HTMLDivElement | null,
  paused: boolean,
  idleMs: number = 1500
): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!container) return;

    if (prefersReducedMotion()) {
      setVisible(true);
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;

    const show = () => {
      setVisible(true);
      if (timer) clearTimeout(timer);
      if (!paused) {
        timer = setTimeout(() => setVisible(false), idleMs);
      }
    };

    container.addEventListener("mousemove", show);
    container.addEventListener("mouseenter", show);
    container.addEventListener("touchstart", show);
    container.addEventListener("focusin", show);

    if (paused) {
      setVisible(true);
      if (timer) clearTimeout(timer);
    } else {
      show();
    }

    return () => {
      container.removeEventListener("mousemove", show);
      container.removeEventListener("mouseenter", show);
      container.removeEventListener("touchstart", show);
      container.removeEventListener("focusin", show);
      if (timer) clearTimeout(timer);
    };
  }, [container, paused, idleMs]);

  return visible;
}
