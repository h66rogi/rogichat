"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PropsWithChildren,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import { cn } from "@/meloming/shared/lib/utils";
import {
  applyPanDelta,
  calcFitZoom,
  centerPan,
  clampZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  wheelToZoomFactor,
  zoomInStep,
  zoomOutStep,
  zoomTowardPoint,
} from "@/meloming/domains/schedule-template/utils/zoom-pan";

/**
 * 캔버스 zoom + pan viewport wrapper (Figma-like canvas).
 *
 * 책임:
 *  - zoom + panX/Y 상태 보유
 *  - 마우스 휠 (Ctrl/Cmd + wheel = pinch on trackpad), 스페이스바 드래그, 단축키
 *    (Cmd+0 fit, Cmd+1 100%, Cmd+= zoom in, Cmd+- zoom out) 처리
 *  - 자식 (실제 캔버스) 에 zoom 값 + 좌표 변환 wrapper 제공
 *  - 우측 하단 zoom indicator + 좌측 하단 zoom controls
 *
 * 자식 (canvas) 는 zoom 값을 props 로 받아 react-rnd 의 `scale` prop 에 전달.
 * 자식의 마우스 이벤트 좌표는 viewport 가 transform 한 inner content 안에서
 * 발생하므로, getBoundingClientRect() 로 inner content 의 위치를 그대로 잡으면
 * 보정된 좌표가 나온다 (자식 측에서 별도 zoom 보정 불필요).
 *
 * 참고:
 *  - 단축키: Cmd / Ctrl 둘 다 지원. preventDefault 로 브라우저 기본 줌 막음.
 *  - 휠 줌: ctrlKey 가 true 면 무조건 줌 (트랙패드 핀치 = ctrlKey 강제).
 *           ctrlKey 가 false 면 일반 휠 → 수직 pan, Shift+휠 → 수평 pan.
 *  - 스페이스바: 누르고 있을 때 cursor 는 grab, 드래그 시 grabbing + pan 적용.
 *  - 미들 마우스 (button=1) 드래그: 항상 pan 모드 (스페이스바 없이도).
 */

interface ScheduleTemplateCanvasViewportProps {
  /** 베이스 이미지 (캔버스) 폭 — design space px. */
  contentW: number;
  /** 베이스 이미지 (캔버스) 높이 — design space px. */
  contentH: number;
  /**
   * 자식에게 zoom 값을 전달하는 render prop.
   * 자식은 받은 zoom 을 react-rnd 의 `scale` prop 에 그대로 넘겨야 드래그/리사이즈 좌표가 보정된다.
   */
  children: (zoom: number) => React.ReactNode;
  /**
   * 헤더 / chrome 표시 여부. 기본은 표시.
   * 모바일 등 공간 절약 모드에서 숨길 수 있음.
   */
  showChrome?: boolean;
}

export function ScheduleTemplateCanvasViewport({
  contentW,
  contentH,
  children,
  showChrome = true,
}: ScheduleTemplateCanvasViewportProps) {
  // viewport DOM ref — wheel/keyboard 이벤트 + bounding rect 측정용.
  const viewportRef = useRef<HTMLDivElement | null>(null);
  // viewport 실제 크기 (resize 시 업데이트). fit zoom 계산에 필요.
  const [viewportSize, setViewportSize] = useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });

  // zoom + pan 상태. 초기값 1 / (0,0) 이지만 첫 렌더 후 fit-to-viewport 로 즉시 보정.
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  // 스페이스바 누르고 있는지 상태 — cursor 변경 + pan 모드 활성용.
  const [spacePressed, setSpacePressed] = useState(false);

  // 첫 마운트 + viewport size 변경 시 자동 fit zoom + center pan 적용.
  // 사용자가 직접 zoom 을 바꾸면 (zoomedManually=true) 자동 fit 을 멈춰서
  // 사용자의 zoom 의도가 사라지지 않게 한다.
  const zoomedManuallyRef = useRef(false);

  // viewport size 측정 (ResizeObserver). 첫 마운트와 리사이즈 모두 커버.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setViewportSize({ w: rect.width, h: rect.height });
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // viewport 크기 / 콘텐츠 크기 가 결정되면 자동 fit (사용자가 수동으로 줌 안 한 경우).
  useEffect(() => {
    if (zoomedManuallyRef.current) return;
    if (viewportSize.w === 0 || viewportSize.h === 0) return;
    if (contentW === 0 || contentH === 0) return;
    const fit = calcFitZoom(contentW, contentH, viewportSize.w, viewportSize.h);
    const center = centerPan(contentW, contentH, viewportSize.w, viewportSize.h, fit);
    setZoom(fit);
    setPanX(center.panX);
    setPanY(center.panY);
  }, [viewportSize.w, viewportSize.h, contentW, contentH]);

  /**
   * cursor 위치 기준으로 zoom 변경. 휠/단축키 양쪽에서 사용.
   * cursorX/Y 가 null 이면 viewport 중심을 기준으로 zoom (단축키 fallback).
   */
  const zoomTo = useCallback(
    (nextZoom: number, cursorX: number | null, cursorY: number | null) => {
      const cx = cursorX ?? viewportSize.w / 2;
      const cy = cursorY ?? viewportSize.h / 2;
      const result = zoomTowardPoint(zoom, panX, panY, cx, cy, nextZoom);
      zoomedManuallyRef.current = true;
      setZoom(result.zoom);
      setPanX(result.panX);
      setPanY(result.panY);
    },
    [zoom, panX, panY, viewportSize.w, viewportSize.h],
  );

  /** Fit-to-viewport 으로 리셋. Cmd+0 단축키 + 툴바 버튼에서 호출. */
  const fitToViewport = useCallback(() => {
    if (viewportSize.w === 0 || viewportSize.h === 0) return;
    if (contentW === 0 || contentH === 0) return;
    const fit = calcFitZoom(contentW, contentH, viewportSize.w, viewportSize.h);
    const center = centerPan(contentW, contentH, viewportSize.w, viewportSize.h, fit);
    zoomedManuallyRef.current = false;
    setZoom(fit);
    setPanX(center.panX);
    setPanY(center.panY);
  }, [viewportSize.w, viewportSize.h, contentW, contentH]);

  /**
   * 100% 로 리셋. Cmd+1 단축키 + 툴바 버튼에서 호출.
   * viewport size 가 아직 측정 안 됐으면 (jsdom 등 환경) center 계산은 skip 하고
   * zoom 만 1 로 reset (사용자가 명확히 100% 를 요청했으므로 항상 적용).
   */
  const reset100 = useCallback(() => {
    zoomedManuallyRef.current = true;
    setZoom(1);
    if (viewportSize.w > 0 && viewportSize.h > 0) {
      const center = centerPan(
        contentW,
        contentH,
        viewportSize.w,
        viewportSize.h,
        1,
      );
      setPanX(center.panX);
      setPanY(center.panY);
    }
  }, [viewportSize.w, viewportSize.h, contentW, contentH]);

  /**
   * 휠 이벤트 — Ctrl/Cmd 가 눌려있거나 트랙패드 핀치(ctrlKey 자동 true)면 zoom,
   * 아니면 pan (수직 / shift+수직 = 수평).
   *
   * preventDefault 로 브라우저 기본 zoom (Ctrl+wheel) / 페이지 스크롤 막음.
   * — viewport 안에서만 막고 페이지 다른 영역의 스크롤은 정상.
   */
  const handleWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      // 이벤트 prevention: 브라우저 zoom + 페이지 스크롤 둘 다 막아야 한다.
      // (passive listener 가 기본인 React onWheel 은 preventDefault 가 동작하므로
      //  옵션 명시 없이 바로 호출 OK)
      e.preventDefault();

      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;

      // Ctrl/Cmd 또는 트랙패드 핀치 (ctrlKey 강제) → zoom
      if (e.ctrlKey || e.metaKey) {
        const factor = wheelToZoomFactor(e.deltaY);
        zoomTo(zoom * factor, cursorX, cursorY);
        return;
      }

      // 일반 wheel → pan. shift+wheel → 수평 pan.
      // wheel delta 부호 그대로: deltaY 양수 = 아래로 휠 = inner content 가 위로 가야 함
      // → panY 감소. 즉 panY -= deltaY. 마찬가지로 panX -= deltaX (또는 deltaY 가 shift 일 때).
      const dx = e.shiftKey ? -e.deltaY : -e.deltaX;
      const dy = e.shiftKey ? 0 : -e.deltaY;
      const next = applyPanDelta(panX, panY, dx, dy);
      setPanX(next.panX);
      setPanY(next.panY);
    },
    [zoom, panX, panY, zoomTo],
  );

  /**
   * 스페이스바 down/up 처리. global window listener 로 viewport 외부에서 키 release
   * 가 일어나도 spacePressed 가 stuck 되지 않게 한다.
   *
   * 주의: input/textarea 안에서 스페이스바를 누르면 pan 모드가 켜지면 안 되므로
   * activeElement 가 form control 이면 무시.
   */
  useEffect(() => {
    const isFormControl = (el: Element | null): boolean => {
      if (!el) return false;
      const tag = el.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (el as HTMLElement).isContentEditable === true
      );
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      if (isFormControl(document.activeElement)) return;
      // 스페이스바 누르고 있는 동안엔 페이지 스크롤이 안 되게.
      e.preventDefault();
      setSpacePressed(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      setSpacePressed(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  /**
   * Cmd/Ctrl + 0/1/=/- 단축키. 모든 OS 키바인딩 케이스 (Cmd vs Ctrl)를 통합.
   * input/textarea 포커스 시엔 단축키 무시 (form 입력 방해 방지).
   */
  useEffect(() => {
    const isFormControl = (el: Element | null): boolean => {
      if (!el) return false;
      const tag = el.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (el as HTMLElement).isContentEditable === true
      );
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (isFormControl(document.activeElement)) return;
      // Cmd+0 → fit
      if (e.key === "0") {
        e.preventDefault();
        fitToViewport();
        return;
      }
      // Cmd+1 → 100%
      if (e.key === "1") {
        e.preventDefault();
        reset100();
        return;
      }
      // Cmd+= 또는 Cmd++ → zoom in. e.key 는 "=" 또는 "+" 두 가지 모두 가능.
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        zoomTo(zoomInStep(zoom), null, null);
        return;
      }
      // Cmd+- → zoom out
      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomTo(zoomOutStep(zoom), null, null);
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fitToViewport, reset100, zoom, zoomTo]);

  /**
   * Pan 드래그 — 스페이스바를 누르고 mousedown 또는 미들 마우스 (button=1) mousedown
   * 으로 시작. mousemove 동안 panX/Y 누적, mouseup 으로 종료.
   *
   * 핸들러는 mousedown 시점에 attach + mouseup 시점에 detach 한다.
   * (마키 selection 처리와 동일한 패턴 — 자식 컴포넌트의 마우스 이벤트와 충돌 방지.)
   */
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const isMiddle = e.button === 1;
      const isPanGesture = isMiddle || (spacePressed && e.button === 0);
      if (!isPanGesture) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      let lastX = startX;
      let lastY = startY;
      const onMove = (m: MouseEvent) => {
        const dx = m.clientX - lastX;
        const dy = m.clientY - lastY;
        lastX = m.clientX;
        lastY = m.clientY;
        setPanX((p) => p + dx);
        setPanY((p) => p + dy);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [spacePressed],
  );

  /**
   * Inner content 의 transform — translate(panX, panY) scale(zoom).
   * transform-origin 0 0 (좌상단) 으로 둬야 zoomTowardPoint 의 수학과 일치.
   */
  const innerStyle: CSSProperties = useMemo(
    () => ({
      width: contentW,
      height: contentH,
      transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
      transformOrigin: "0 0",
      // zoom 변경 시 transform 만 바꾸므로 GPU acceleration 가능하게 will-change.
      willChange: "transform",
    }),
    [contentW, contentH, panX, panY, zoom],
  );

  // chrome (zoom 표시 / 컨트롤) 에 보여줄 zoom 퍼센트.
  const zoomPercent = Math.round(zoom * 100);

  return (
    <div className="relative h-full w-full flex flex-col">
      {/* Viewport — overflow:hidden + transform 된 inner content. checker bg 로 캔버스 밖 표현. */}
      <div
        ref={viewportRef}
        data-testid="schedule-template-canvas-viewport"
        className={cn(
          "relative flex-1 min-h-0 overflow-hidden select-none",
          // checker pattern background — Figma 와 비슷하게 캔버스 밖 영역 시각화.
          "bg-[linear-gradient(45deg,#f3f4f6_25%,transparent_25%),linear-gradient(-45deg,#f3f4f6_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f3f4f6_75%),linear-gradient(-45deg,transparent_75%,#f3f4f6_75%)]",
          "bg-[length:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0]",
          spacePressed ? "cursor-grab" : "cursor-default",
        )}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        // 스페이스바 + 드래그 중에는 cursor:grabbing — JS 로는 mousedown 안에서 갱신할 수 없어서
        // CSS active state 로 다음 mousedown 까지의 visual feedback 만 처리.
        style={{ cursor: spacePressed ? "grab" : undefined }}
      >
        <div data-testid="schedule-template-canvas-inner" style={innerStyle}>
          {children(zoom)}
        </div>

        {/* Zoom controls (좌하단) */}
        {showChrome ? (
          <div
            data-testid="schedule-template-zoom-controls"
            className="absolute bottom-3 left-3 flex items-center gap-1 rounded-md border bg-background/90 px-1 py-1 shadow-sm backdrop-blur"
          >
            <button
              type="button"
              onClick={() => zoomTo(zoomOutStep(zoom), null, null)}
              disabled={zoom <= MIN_ZOOM + 1e-6}
              aria-label="축소"
              title="축소 (Cmd+-)"
              className="rounded p-1 hover:bg-muted disabled:opacity-40"
            >
              <Minus className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={fitToViewport}
              aria-label="화면에 맞춤"
              title="화면에 맞춤 (Cmd+0)"
              className="rounded p-1 hover:bg-muted"
            >
              <Maximize2 className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => zoomTo(zoomInStep(zoom), null, null)}
              disabled={zoom >= MAX_ZOOM - 1e-6}
              aria-label="확대"
              title="확대 (Cmd+=)"
              className="rounded p-1 hover:bg-muted disabled:opacity-40"
            >
              <Plus className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={reset100}
              aria-label="100%"
              title="100% (Cmd+1)"
              className="rounded px-2 py-0.5 text-xs hover:bg-muted"
            >
              100%
            </button>
          </div>
        ) : null}

        {/* Zoom indicator (우하단) */}
        {showChrome ? (
          <div
            data-testid="schedule-template-zoom-indicator"
            className="absolute bottom-3 right-3 rounded-md border bg-background/90 px-2.5 py-1 text-xs font-medium shadow-sm backdrop-blur tabular-nums"
            aria-live="polite"
          >
            {zoomPercent}%
          </div>
        ) : null}

        {/* 키보드 힌트 (우상단) — 처음에만 살짝 보였다가 fade out 시키고 싶으면 추후 가능 */}
        {showChrome ? (
          <div className="absolute top-3 right-3 hidden md:block rounded-md bg-background/70 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur">
            ⌘+휠 줌 · ⌘0 맞춤 · ⌘1 100% · 스페이스+드래그 이동
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 자식 컴포넌트가 zoom 을 안전하게 받도록 하는 헬퍼 hook.
 * — 현재는 단순 react state 패턴이라 hook 자체는 viewport 내부에서만 사용. 외부 노출은 props 로.
 */
export type { ScheduleTemplateCanvasViewportProps };

// Re-export utility constants so consumers can build matching UI (e.g.
// disable buttons at MIN/MAX zoom).
export { clampZoom, MAX_ZOOM, MIN_ZOOM };

// Wrapper helper: PropsWithChildren convenience for consumers that don't
// need the zoom render-prop pattern (rare — keep for completeness).
export function ScheduleTemplateCanvasViewportFixedZoom({
  contentW,
  contentH,
  zoom,
  children,
}: PropsWithChildren<{
  contentW: number;
  contentH: number;
  zoom: number;
}>) {
  // Static-zoom variant for tests / preview embeds. Not used by the main editor.
  const safeZoom = clampZoom(zoom);
  return (
    <div className="relative h-full w-full overflow-auto bg-muted/30">
      <div
        style={{
          width: contentW,
          height: contentH,
          transform: `scale(${safeZoom})`,
          transformOrigin: "0 0",
        }}
      >
        {children}
      </div>
    </div>
  );
}
