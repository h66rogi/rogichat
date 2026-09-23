'use client';
import {
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import {
  TransformWrapper,
  TransformComponent,
  type ReactZoomPanPinchContentRef,
  type ReactZoomPanPinchRef,
} from 'react-zoom-pan-pinch';
import { cn } from '@/meloming/shared/lib/utils';

/**
 * forScore / Newzik / Piascore 등 시장 표준 악보 뷰어 UX 통일 wrapper.
 *
 * 표준 명세 (2026-05-05 spec 10.5 확정):
 *  - viewport: 박스 안에서 자급자족, 외부 스크롤바 없음 (overflow-hidden)
 *  - zoom 1.0  = 페이지 전체 fit, pan 불가
 *  - zoom > 1 = 한 손가락 drag 으로 viewport 안에서만 pan (limitToBounds)
 *  - swipe 좌/우 (scale === 1 일 때만 발화) = 다음/이전 페이지
 *  - double tap = zoom 1.0 ↔ 직전 zoom 레벨 토글
 *  - pinch range 0.25~5
 *
 * 외부 zoom state 와 내부 TransformWrapper state 동기화:
 *  - 외부 zoom prop 변경 (toolbar +/-, 단축키) → setTransform 으로 내부 반영
 *  - 내부 pinch / double-tap → onTransformed 콜백으로 외부에 알림
 */
const PINCH_MIN = 0.25;
const PINCH_MAX = 5;
const SWIPE_THRESHOLD_PX = 60;
const DOUBLE_TAP_DEFAULT_ZOOM = 2;

export interface SheetMusicCanvasProps {
  /** 안에 그릴 page renderer (Pdf / Image / MusicXML 단일 페이지). */
  children: ReactNode;
  /** 외부에서 관리하는 effective zoom (fitMode 계산 후 결정된 값). */
  zoom: number;
  /** 내부에서 사용자가 pinch / double-tap 으로 zoom 변경 시 호출. fitMode='none' 진입. */
  onZoomChange?: (zoom: number) => void;
  /** scale === 1 상태에서 좌/우 swipe 시. 다음 페이지 / 이전 페이지 nav 용. */
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  /** swipe / pan 사용 가능 여부 (다중 페이지 컨텍스트에서만 활성). */
  canPagePrev?: boolean;
  canPageNext?: boolean;
  className?: string;
}

export function SheetMusicCanvas({
  children,
  zoom,
  onZoomChange,
  onSwipeLeft,
  onSwipeRight,
  canPagePrev = false,
  canPageNext = false,
  className,
}: SheetMusicCanvasProps) {
  const apiRef = useRef<ReactZoomPanPinchContentRef | null>(null);
  // double-tap 토글용 직전 zoom 레벨 (1.0 이 아닌 마지막 줌). 처음엔 default 2.0.
  const lastNonOneZoomRef = useRef<number>(DOUBLE_TAP_DEFAULT_ZOOM);
  // touch swipe — scale === 1 에서만 horizontal drag 으로 page nav.
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  // 외부 zoom prop ↔ TransformWrapper 동기화. fit 모드 변경, 단축키 +/-, toolbar
  // 클릭 등으로 외부 zoom 이 바뀌면 내부에 반영. 단 내부에서 자체적으로 zoom
  // 한 결과가 외부로 round-trip 되어 들어온 경우는 setTransform 호출이 무한
  // 루프를 만들 수 있어 0.001 epsilon 으로 컷.
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const current = api.state.scale;
    if (Math.abs(current - zoom) > 0.001) {
      api.setTransform(api.state.positionX, api.state.positionY, zoom, 200);
    }
    if (Math.abs(zoom - 1) > 0.01) lastNonOneZoomRef.current = zoom;
  }, [zoom]);

  const handleDoubleClick = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    const target =
      Math.abs(api.state.scale - 1) < 0.01
        ? lastNonOneZoomRef.current || DOUBLE_TAP_DEFAULT_ZOOM
        : 1;
    api.setTransform(0, 0, target, 200);
    onZoomChange?.(target);
  }, [onZoomChange]);

  const handleTouchStart = useCallback((e: ReactTouchEvent<HTMLDivElement>) => {
    const api = apiRef.current;
    if (!api) return;
    if (Math.abs(api.state.scale - 1) > 0.01) {
      // zoom > 1 또는 < 1 — pan 모드라 swipe 판정 안 함
      touchStartRef.current = null;
      return;
    }
    if (e.touches.length !== 1) {
      touchStartRef.current = null;
      return;
    }
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  }, []);

  const handleTouchEnd = useCallback(
    (e: ReactTouchEvent<HTMLDivElement>) => {
      const start = touchStartRef.current;
      touchStartRef.current = null;
      if (!start) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      // 가로 우세 + 임계값 통과만 swipe 로 인정 (세로 스크롤과 충돌 방지)
      if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;
      if (Math.abs(dx) < Math.abs(dy)) return;
      if (dx < 0 && canPageNext) onSwipeLeft?.();
      else if (dx > 0 && canPagePrev) onSwipeRight?.();
    },
    [canPageNext, canPagePrev, onSwipeLeft, onSwipeRight],
  );

  return (
    <div
      className={cn(
        // viewport 박스 — forScore 의 윈도우 역할.
        'w-full h-[60vh] max-h-[600px] min-h-[240px] overflow-hidden bg-muted/30 rounded',
        className,
      )}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onDoubleClick={handleDoubleClick}
    >
      <TransformWrapper
        ref={apiRef}
        initialScale={zoom}
        minScale={PINCH_MIN}
        maxScale={PINCH_MAX}
        centerOnInit
        // zoom 1.0 시 viewport 안에 fit 된 채로 pan 봉쇄.
        // zoom > 1 시 viewport 밖으로 끌려나가지 못하게 boundary 강제.
        limitToBounds
        // 내부 zoom 변경 (pinch / wheel) 후 외부 state 와 동기화. 라이브러리는
        // onTransformed prop 을 노출하지 않아 stop 콜백 3종으로 분기.
        onZoomStop={(ref: ReactZoomPanPinchRef) => {
          const s = ref.state.scale;
          if (Math.abs(s - zoom) > 0.01) onZoomChange?.(s);
          if (Math.abs(s - 1) > 0.01) lastNonOneZoomRef.current = s;
        }}
        onPinchStop={(ref: ReactZoomPanPinchRef) => {
          const s = ref.state.scale;
          if (Math.abs(s - zoom) > 0.01) onZoomChange?.(s);
          if (Math.abs(s - 1) > 0.01) lastNonOneZoomRef.current = s;
        }}
        onWheelStop={(ref: ReactZoomPanPinchRef) => {
          const s = ref.state.scale;
          if (Math.abs(s - zoom) > 0.01) onZoomChange?.(s);
          if (Math.abs(s - 1) > 0.01) lastNonOneZoomRef.current = s;
        }}
        // double-click 자체는 우리가 onDoubleClick 으로 처리. 라이브러리 기본
        // 동작 비활성화하여 충돌 방지.
        doubleClick={{ disabled: true }}
      >
        <TransformComponent
          wrapperClass="!w-full !h-full"
          contentClass="!w-full !h-full flex items-center justify-center"
        >
          {children}
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
}
