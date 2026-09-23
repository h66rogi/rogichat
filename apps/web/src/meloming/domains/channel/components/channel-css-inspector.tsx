"use client";

import { useEffect, useRef } from "react";

/**
 * DevTools 스타일 요소 선택기 — 채널 페이지 미리보기 iframe 안쪽에서 동작.
 *
 * cssPreview=true + 부모 프레임(window.parent !== window)에서만 활성화되며
 * 부모 창과 postMessage로 통신한다. same-origin 혼선을 막기 위해 메시지의
 * `event.source`가 실제 부모 창인지까지 검증한다.
 *   - 수신: CHANNEL_CSS_INSPECTOR_START / CHANNEL_CSS_INSPECTOR_STOP
 *   - 송신: CHANNEL_CSS_INSPECTOR_PICKED (selector), CHANNEL_CSS_INSPECTOR_STOPPED
 *
 * 선택자 빌더는 #channel-container를 루트로 삼고 클릭 대상까지 거슬러 올라가며
 * tag 또는 tag.class 조각을 연결한다. CSS-in-JS 해시/Tailwind arbitrary value 등
 * 불안정한 클래스는 제외해서 가독성을 유지한다.
 */
export function ChannelCssInspector() {
  const activeRef = useRef(false);
  const highlightedRef = useRef<HTMLElement | null>(null);
  // 하이라이트 전 원본 inline outline 값을 보존해두고 종료 시 정확히 복원
  const originalOutlineRef = useRef<{
    outline: string;
    outlineOffset: string;
  } | null>(null);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("cssPreview") !== "true") return;
    // iframe 외부(일반 방문자가 직접 URL을 연 경우)에서는 리스너를 등록하지 않음
    if (window.parent === window) return;

    const ROOT_SELECTOR = "#channel-container";

    const clearHighlight = () => {
      if (highlightedRef.current && originalOutlineRef.current) {
        highlightedRef.current.style.outline = originalOutlineRef.current.outline;
        highlightedRef.current.style.outlineOffset =
          originalOutlineRef.current.outlineOffset;
      }
      highlightedRef.current = null;
      originalOutlineRef.current = null;
    };

    const setHighlight = (el: HTMLElement) => {
      if (highlightedRef.current === el) return;
      clearHighlight();
      originalOutlineRef.current = {
        outline: el.style.outline,
        outlineOffset: el.style.outlineOffset,
      };
      el.style.outline = "2px solid #6366f1";
      el.style.outlineOffset = "-2px";
      highlightedRef.current = el;
    };

    const buildSelector = (target: HTMLElement): string => {
      const root = document.querySelector(ROOT_SELECTOR) as HTMLElement | null;
      if (!root) return ROOT_SELECTOR;
      if (target === root) return ROOT_SELECTOR;
      // 루트 외부(사이드바/헤더 등)를 클릭한 경우 루트 셀렉터만 반환
      if (!root.contains(target)) return ROOT_SELECTOR;

      const path: string[] = [];
      let node: HTMLElement | null = target;
      let depth = 0;
      while (node && node !== root && depth < 6) {
        const tag = node.tagName.toLowerCase();
        const stableClass = Array.from(node.classList).find(
          (cls) =>
            cls.length >= 3 &&
            cls.length <= 40 &&
            !/^(css-|sc-|cm-|_)/i.test(cls) &&
            !/^[a-z0-9]{8,}$/i.test(cls) &&
            !/\[|\]|\(|\)|:/.test(cls)
        );
        path.unshift(stableClass ? `${tag}.${stableClass}` : tag);
        node = node.parentElement;
        depth += 1;
      }
      return `${ROOT_SELECTOR} ${path.join(" > ")}`.trim();
    };

    const stopInspector = () => {
      if (!activeRef.current) return;
      activeRef.current = false;
      document.body.style.cursor = "";
      clearHighlight();
      document.removeEventListener("mousemove", handleMouseMove, true);
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.parent.postMessage(
        { type: "CHANNEL_CSS_INSPECTOR_STOPPED" },
        window.location.origin
      );
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!activeRef.current) return;
      const target = e.target as HTMLElement | null;
      if (target && target.nodeType === 1) {
        setHighlight(target);
      }
    };

    const handleClick = (e: MouseEvent) => {
      if (!activeRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const selector = buildSelector(target);
      window.parent.postMessage(
        { type: "CHANNEL_CSS_INSPECTOR_PICKED", selector },
        window.location.origin
      );
      stopInspector();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeRef.current && e.key === "Escape") {
        stopInspector();
      }
    };

    const startInspector = () => {
      if (activeRef.current) return;
      activeRef.current = true;
      document.body.style.cursor = "crosshair";
      document.addEventListener("mousemove", handleMouseMove, true);
      document.addEventListener("click", handleClick, true);
      document.addEventListener("keydown", handleKeyDown, true);
    };

    const handleMessage = (event: MessageEvent) => {
      // 1) origin + source 모두 검증: same-origin 환경에서도 부모 창이 아닌
      //    다른 프레임/탭이 START/STOP을 보내 인스펙터를 오작동시키는 걸 차단
      if (event.origin !== window.location.origin) return;
      if (event.source !== window.parent) return;
      // 2) 데이터 스키마 검증
      const data = event.data;
      if (!data || typeof data !== "object" || typeof data.type !== "string") {
        return;
      }
      if (data.type === "CHANNEL_CSS_INSPECTOR_START") {
        startInspector();
      } else if (data.type === "CHANNEL_CSS_INSPECTOR_STOP") {
        stopInspector();
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      stopInspector();
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  return null;
}
