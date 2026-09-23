"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Lock } from "lucide-react";
import { Rnd, type DraggableData, type HandleStyles } from "react-rnd";
import { useIsMobile } from "@/meloming/shared/hooks/use-mobile";
import { cn } from "@/meloming/shared/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/meloming/shared/components/ui/context-menu";
import type {
  ImageSlot,
  TemplateSlot,
  TextSlot,
} from "@/meloming/domains/schedule-template/types/template-spec";
import { computeSnap, DEFAULT_GRID_SIZE } from "@/meloming/domains/schedule-template/utils/snap";
import {
  slotsIntersectingMarquee,
  type MarqueeRect,
} from "@/meloming/domains/schedule-template/utils/marquee";

/**
 * 클릭 modifier — multi-select 분기에 사용 (Phase 2B).
 *
 * - `shiftKey` / `metaKey` (Mac Cmd) / `ctrlKey` (Windows Ctrl) 중 하나라도 true 면
 *   해당 슬롯의 선택 상태를 toggle (이미 선택돼 있으면 빼고, 아니면 추가).
 * - 모두 false 면 단일 선택 (기존 동작).
 */
export interface SelectModifiers {
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
}

interface ScheduleTemplateEditorCanvasProps {
  baseImageUrl: string;
  baseImageW: number;
  baseImageH: number;
  slots: TemplateSlot[];
  /** 다중 선택된 슬롯 ID 배열 (Phase 2B). 단일 선택은 length=1. */
  selectedIds: string[];
  /**
   * 슬롯 선택 / 추가 / 토글. modifier 가 있으면 multi-select 동작.
   */
  onSelect: (id: string, modifiers?: SelectModifiers) => void;
  /** 캔버스 배경 클릭 등으로 선택 해제 요청. */
  onDeselect: () => void;
  /** 마키 (마우스 드래그) 로 선택된 ID 들을 통째로 교체. */
  onMarqueeSelect: (ids: string[]) => void;
  /** 단일 슬롯 patch — 리사이즈 / 속성 변경 (이동은 onSlotsMove 사용). */
  onSlotChange: (id: string, patch: Partial<TemplateSlot>) => void;
  /**
   * 슬롯들 일괄 이동 (Phase 2C 그룹 지원). drag stop 시점에 호출.
   * `ids` 는 보통 dragged 슬롯 + 같은 groupId 의 멤버 모두.
   * 단일 슬롯이면 ids.length === 1 이어도 같은 호출 경로.
   */
  onSlotsMove: (ids: string[], dx: number, dy: number) => void;
  /** 우클릭 메뉴: 선택된 슬롯들 삭제. */
  onDeleteSelected: () => void;
  /** 우클릭 메뉴: 선택된 슬롯들 복제. */
  onDuplicateSelected: () => void;
  /** 그리드 스냅 활성 여부. 캔버스 헤더 토글로 제어. */
  gridSnapEnabled: boolean;
  /**
   * 캔버스 viewport zoom 배율 (1 = 100%). 부모 viewport 컴포넌트가 transform: scale 로
   * 시각 줌을 적용하고, 이 값을 자식에게 전달해 react-rnd 의 `scale` prop 으로 넘겨야
   * 드래그/리사이즈 좌표가 zoom 배율에 비례해 보정된다.
   * Default 1 — viewport wrapper 가 없는 (구버전) 호출 경로 호환성.
   */
  zoom?: number;
  /**
   * 캔버스 chrome (헤더 / 안내 텍스트) 표시 여부. viewport wrapper 안에서 사용 시
   * 헤더 중복을 피하기 위해 false 로 끌 수 있다. 기본 true (단독 사용 시 hint 노출).
   */
  showHeader?: boolean;
  /**
   * 배경(빈 영역) 클릭 콜백. drag 가 아니라 단순 click 으로 끝났을 때만 호출.
   * 반환값 true 면 caller 가 핸들링했음을 의미하고, 기본 deselect 동작을 건너뛴다.
   * 반환값 false / 미반환 / undefined prop 이면 기본 동작 (deselect).
   *
   * Photoshop tool-aware 캔버스 동작용 — Type/Image/Rectangle/Eyedropper 도구 활성 시
   * 클릭 좌표를 받아 슬롯 추가/색상 추출 등을 수행.
   */
  onBackgroundClick?: (
    designX: number,
    designY: number,
    modifiers: SelectModifiers,
  ) => boolean;
}

/**
 * 터치 디바이스용 리사이즈 핸들 hit-area.
 *
 * 데스크톱은 react-rnd 기본 (10×10) 으로 충분하지만, 모바일에서는 손가락 끝으로
 * 잡기 어렵다. WCAG/HIG 권장 최소 터치 타겟인 44px 정도까지 확장해 정확도를 높인다.
 * 시각적인 마커는 배경색/테두리로 작게 보이지만, 실제 hit-area 는 box-shadow inset
 * 없이 자연 크기로 잡는다. (transform/translate 으로 시프트하면 react-draggable
 * 의 좌표 계산과 충돌하므로 가장자리 anchor 를 그대로 두고 크기만 키운다.)
 */
const TOUCH_HANDLE_SIZE = 28;
const TOUCH_HANDLE_OFFSET = -(TOUCH_HANDLE_SIZE / 2);
const TOUCH_HANDLE_VISUAL =
  "inset 0 0 0 1px rgba(255,255,255,0.9), 0 0 0 1px var(--color-primary)";

function buildTouchHandleStyles(): HandleStyles {
  const corner: CSSProperties = {
    width: TOUCH_HANDLE_SIZE,
    height: TOUCH_HANDLE_SIZE,
    backgroundColor: "var(--color-primary)",
    borderRadius: 9999,
    boxShadow: TOUCH_HANDLE_VISUAL,
    // 손가락 닿는 영역은 자연 박스 그대로 (transform 금지 — drag 좌표와 충돌).
    // 코너 핸들은 react-rnd 가 left/top/right/bottom 으로 픽셀 anchor 함.
  };
  const edge: CSSProperties = {
    backgroundColor: "transparent",
    // edge handle 은 폭/높이 한 쪽만 길게 — 반대 축은 corner 사이즈 유지.
    // react-rnd 가 left/right 핸들의 width 를 적용하므로 height 는 부모(슬롯) 가
    // 그대로 사용한다. 시각화는 생략하고 hit-area 만 확장.
  };
  return {
    topLeft: { ...corner, top: TOUCH_HANDLE_OFFSET, left: TOUCH_HANDLE_OFFSET },
    topRight: {
      ...corner,
      top: TOUCH_HANDLE_OFFSET,
      right: TOUCH_HANDLE_OFFSET,
    },
    bottomLeft: {
      ...corner,
      bottom: TOUCH_HANDLE_OFFSET,
      left: TOUCH_HANDLE_OFFSET,
    },
    bottomRight: {
      ...corner,
      bottom: TOUCH_HANDLE_OFFSET,
      right: TOUCH_HANDLE_OFFSET,
    },
    top: { ...edge, height: TOUCH_HANDLE_SIZE, top: TOUCH_HANDLE_OFFSET },
    bottom: {
      ...edge,
      height: TOUCH_HANDLE_SIZE,
      bottom: TOUCH_HANDLE_OFFSET,
    },
    left: { ...edge, width: TOUCH_HANDLE_SIZE, left: TOUCH_HANDLE_OFFSET },
    right: { ...edge, width: TOUCH_HANDLE_SIZE, right: TOUCH_HANDLE_OFFSET },
  };
}

const TOUCH_HANDLE_STYLES = buildTouchHandleStyles();

/**
 * 베이스 이미지 위에 슬롯을 배치/드래그/리사이즈할 수 있는 편집 캔버스.
 *
 * 좌표계: baseImage 의 원본 px 기준.
 *   - Rnd 도 동일한 px 공간을 사용해 position/size 가 그대로 저장값이 된다.
 *   - 에디터 영역이 이미지보다 좁거나 넓어도 `overflow: auto` 로 스크롤만 제공.
 *   - 추후 scale-to-fit 개선 여지 있음 (Rnd 계산 시 factor 곱하기) — MVP 는 단순 1:1.
 *
 * 슬롯 시각 표현은 속성을 근사화한 CSS 렌더. 실제 서버 렌더(@F5) 와 1:1 이 아니라
 * "어디에 뭐가 온다" 를 감각적으로 보여주는 용도.
 *
 * Phase 2B 추가:
 *  - Multi-select (shift / cmd 클릭, 마키 드래그)
 *  - Snap-to-grid + snap-to-slot (드래그 중 가이드 라인)
 *  - 우클릭 컨텍스트 메뉴 (삭제 / 복제)
 *
 * Phase 2C 추가:
 *  - locked: 드래그/리사이즈 비활성, 마키 선택 제외, 클릭 선택 가능, 잠금 아이콘 overlay
 *  - hidden: 캔버스에서 렌더 X (아예 mount 하지 않음)
 *  - groupId: 같은 그룹 슬롯 한 개를 드래그하면 그룹 전체가 같은 delta 로 이동
 */
export function ScheduleTemplateEditorCanvas({
  baseImageUrl,
  baseImageW,
  baseImageH,
  slots,
  selectedIds,
  onSelect,
  onDeselect,
  onMarqueeSelect,
  onSlotChange,
  onSlotsMove,
  onDeleteSelected,
  onDuplicateSelected,
  gridSnapEnabled,
  zoom = 1,
  showHeader = true,
  onBackgroundClick,
}: ScheduleTemplateEditorCanvasProps) {
  // 모바일은 손가락 터치 정확도가 낮아 핸들 hit-area 를 키운다. 데스크톱은 기본 유지.
  const isMobile = useIsMobile();
  const resizeHandleStyles = isMobile ? TOUCH_HANDLE_STYLES : undefined;

  // 마키 (마우스 드래그) 상태 — Phase 2B IMPORTANT fix (Codex 2B-1):
  //  이전 구현은 ref 변경에 useEffect 가 반응하지 못해 listener 가 stale-attach 되거나
  //  미연결되는 케이스가 있었다. 이제는 mousedown 핸들러 안에서 직접 window 리스너를
  //  attach 하고, mouseup 시 같은 closure 에서 detach 한다. setMarquee 만 사용하므로
  //  ref 의존이 사라지고, 핸들러는 항상 동일 render 의 setter 를 본다.
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const backgroundRef = useRef<HTMLDivElement | null>(null);

  // 드래그 중 가이드 라인 (스냅 위치).
  const [activeGuide, setActiveGuide] = useState<{
    guideX: number | null;
    guideY: number | null;
  }>({ guideX: null, guideY: null });

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  /**
   * 캔버스 배경 mousedown — 마키 selection 시작 + window listener 직접 attach.
   * Rnd 자식이 mousedown 한 경우는 e.target !== currentTarget 이므로 무시한다.
   *
   * 핵심 (2B-1 fix):
   *  - useEffect 의존성 변동(ref/state) 으로 listener 가 stale-attach 되는 문제를
   *    피하기 위해 mousedown 시점에 직접 attach + mouseup 시 같은 closure 에서 detach.
   *  - locked 슬롯은 마키 결과에서 제외 — 잠긴 슬롯은 마키로 잡히지 않는다.
   *  - hidden 슬롯도 마키 결과에서 명시적 제외 (Phase 2C-2 fix). 캔버스에 mount 되지
   *    않더라도, slots prop 자체에는 hidden 슬롯이 들어있으므로 candidates 단계에서
   *    필터하지 않으면 보이지 않는 슬롯이 마키로 선택되어 multi-select 가 어긋난다.
   *
   * Zoom 보정 (Figma-canvas):
   *  - backgroundRef 가 transform: scale() 안에 있으면 getBoundingClientRect() 가
   *    이미 zoom 배율이 적용된 화면 크기를 반환한다. 즉 (clientX - rect.left) 로 얻은
   *    값은 "scaled background 안의 screen-space px" 이므로, design-space 좌표로
   *    변환하려면 zoom 으로 나눠야 한다. 그래야 마키 박스가 슬롯의 design-space
   *    좌표 (x/y/w/h) 와 정확히 매치된다.
   *  - zoom=1 일 때는 1로 나누는 것이므로 동작 변화 없음 (기존 호출 경로 보존).
   */
  const handleBackgroundMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      // 우클릭은 마키 시작 X
      if (e.button !== 0) return;

      // 캔버스 좌표 계산 — backgroundRef 를 기준으로 offset 계산.
      const rect = backgroundRef.current?.getBoundingClientRect();
      if (!rect) {
        onDeselect();
        return;
      }
      // Zoom-aware screen→design 변환: scaled rect 안의 offset 을 zoom 으로 나눔.
      // zoom=0 방어 (theoretically clampZoom 이 막지만 viewport 외부 호출 호환).
      const safeZoom = zoom <= 0 ? 1 : zoom;
      const startX = (e.clientX - rect.left) / safeZoom;
      const startY = (e.clientY - rect.top) / safeZoom;

      // tool-aware 클릭 핸들러가 등록되어 있으면 deselect/marquee 를 우회하고
      // mouseup 시 단순 click 으로 dispatch 한다. drag 가 시작되면 marquee 로 폴백.
      const hasToolHandler = typeof onBackgroundClick === "function";

      // 모디파이어 없는 클릭은 선택 해제. shift/cmd 가 있으면 기존 선택 유지.
      // 단, tool 핸들러가 있으면 click 결과에 따라 deselect 를 결정 (mouseup 에서).
      if (!hasToolHandler && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        onDeselect();
      }

      const modifiers: SelectModifiers = {
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
      };

      // 마키 listener — closure 에서 startX/Y, slots 를 캡처. drag 중 slots 가
      // 변경될 일은 거의 없지만 (drag 와 슬롯 추가가 동시에 일어나지 않음), 만약
      // 변경된다면 다음 mousedown 부터 새 closure 가 반영한다.
      let started = false;
      const onMove = (m: MouseEvent) => {
        const r = backgroundRef.current?.getBoundingClientRect();
        if (!r) return;
        const currentX = (m.clientX - r.left) / safeZoom;
        const currentY = (m.clientY - r.top) / safeZoom;
        const w = currentX - startX;
        const h = currentY - startY;
        // 너무 작은 움직임 (< 3px design-space) 은 click 으로 간주, 마키 미시작.
        if (!started && Math.abs(w) < 3 && Math.abs(h) < 3) return;
        started = true;
        const next: MarqueeRect = { x: startX, y: startY, w, h };
        setMarquee(next);
        // locked / hidden 슬롯은 마키 결과에서 제외 (Phase 2C-2).
        const candidates = slots.filter(
          (s) => s.locked !== true && s.hidden !== true,
        );
        const intersected = slotsIntersectingMarquee(candidates, next);
        onMarqueeSelect(intersected);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        setMarquee(null);
        // drag 가 일어나지 않았고 tool 핸들러가 있으면 click 으로 dispatch.
        if (!started && hasToolHandler) {
          const handled = onBackgroundClick!(startX, startY, modifiers);
          if (!handled && !modifiers.shiftKey && !modifiers.metaKey && !modifiers.ctrlKey) {
            onDeselect();
          }
        }
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [onDeselect, onMarqueeSelect, slots, zoom, onBackgroundClick],
  );

  // 캔버스 헤더에 그리드 표시는 시각적 노이즈가 클 수 있어, 그리드 활성 시에도
  // overlay grid line 은 그리지 않고 스냅 동작만 활성화한다. (Figma 도 기본은 그리드 hide.)

  // Phase 2C: 그룹 멤버 lookup. groupId → 같은 그룹의 모든 슬롯 ID.
  // 드래그 시 이 lookup 으로 함께 이동시킬 슬롯들을 결정한다.
  const groupMembership = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const s of slots) {
      if (!s.groupId) continue;
      const arr = map.get(s.groupId) ?? [];
      arr.push(s.id);
      map.set(s.groupId, arr);
    }
    return map;
  }, [slots]);

  return (
    <div className="flex h-full flex-col">
      {showHeader ? (
        <div className="border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground flex items-center justify-between">
          <span>
            캔버스 ({baseImageW} × {baseImageH}px · 좌상단 기준)
          </span>
          {/* F14: 데스크톱 전용 힌트. breakpoint 는 `useIsMobile` (768px) 와 일치시켜 —
              `sm:`(640) 쓰면 640~767px 구간에서 모바일 레이아웃인데도 "오른쪽 패널" 안내가 떠 어긋난다. */}
          <span className="hidden md:inline">
            드래그/리사이즈해서 배치 → 오른쪽 패널에서 세부 편집
            {gridSnapEnabled ? " · 그리드 스냅 ON" : ""}
          </span>
        </div>
      ) : null}

      <div
        className={cn(
          "flex-1",
          // viewport wrapper 가 transform/overflow 를 처리할 때는 (zoom !== 1 인 경우 또는
          // showHeader=false 인 경우 — viewport 안에 임베드된 신호) 이 영역의 background/
          // overflow 를 제거해서 chrome 중복을 피한다.
          zoom === 1 && showHeader
            ? "overflow-auto bg-[color-mix(in_oklab,var(--muted)_60%,transparent)]"
            : "overflow-visible",
        )}
      >
        <div
          className={cn(
            "relative",
            // viewport 모드에서는 inner content 가 이미 transform 으로 위치/크기를 잡으므로
            // mx-auto/my-4 (centering padding) 는 필요 없다. 단독 사용 (zoom=1, showHeader)
            // 모드에서는 기존 centering 유지.
            zoom === 1 && showHeader ? "mx-auto my-4" : "",
          )}
          style={{ width: baseImageW }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={baseImageUrl}
            alt="베이스 이미지"
            width={baseImageW}
            height={baseImageH}
            className="block select-none"
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
          />

          <div
            ref={backgroundRef}
            data-testid="schedule-template-canvas-background"
            className="absolute inset-0"
            style={{ width: baseImageW, height: baseImageH }}
            onMouseDown={handleBackgroundMouseDown}
          >
            {slots.map((slot) => {
              // Phase 2C: hidden 슬롯은 캔버스에서 mount 하지 않는다.
              if (slot.hidden === true) return null;
              return (
                <SlotRnd
                  key={slot.id}
                  slot={slot}
                  allSlots={slots}
                  selected={selectedIdSet.has(slot.id)}
                  anySelected={selectedIds.length > 0}
                  groupMembership={groupMembership}
                  onSelect={(modifiers) => onSelect(slot.id, modifiers)}
                  onChange={(patch) => onSlotChange(slot.id, patch)}
                  onMoveSlots={onSlotsMove}
                  onDeleteSelected={onDeleteSelected}
                  onDuplicateSelected={onDuplicateSelected}
                  resizeHandleStyles={resizeHandleStyles}
                  canvasW={baseImageW}
                  canvasH={baseImageH}
                  gridSnapEnabled={gridSnapEnabled}
                  onSnapGuide={setActiveGuide}
                  zoom={zoom}
                />
              );
            })}

            {/* 마키 박스 시각화 */}
            {marquee && (
              <div
                data-testid="schedule-template-marquee"
                className="pointer-events-none absolute border border-primary/60 bg-primary/10"
                style={{
                  left: marquee.w < 0 ? marquee.x + marquee.w : marquee.x,
                  top: marquee.h < 0 ? marquee.y + marquee.h : marquee.y,
                  width: Math.abs(marquee.w),
                  height: Math.abs(marquee.h),
                }}
              />
            )}

            {/* 스냅 가이드 라인 (드래그 중) */}
            {activeGuide.guideX !== null && (
              <div
                data-testid="schedule-template-snap-guide-x"
                className="pointer-events-none absolute top-0 bottom-0"
                style={{
                  left: activeGuide.guideX - 0.5,
                  width: 1,
                  backgroundColor: "#ec4899",
                }}
              />
            )}
            {activeGuide.guideY !== null && (
              <div
                data-testid="schedule-template-snap-guide-y"
                className="pointer-events-none absolute left-0 right-0"
                style={{
                  top: activeGuide.guideY - 0.5,
                  height: 1,
                  backgroundColor: "#ec4899",
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface SlotRndProps {
  slot: TemplateSlot;
  allSlots: TemplateSlot[];
  selected: boolean;
  anySelected: boolean;
  /** groupId → 같은 그룹의 모든 슬롯 ID (Phase 2C). drag 시 함께 이동할 대상 lookup. */
  groupMembership: Map<string, string[]>;
  onSelect: (modifiers?: SelectModifiers) => void;
  onChange: (patch: Partial<TemplateSlot>) => void;
  onMoveSlots: (ids: string[], dx: number, dy: number) => void;
  onDeleteSelected: () => void;
  onDuplicateSelected: () => void;
  /** 모바일 등 큰 hit-area 가 필요한 경우 핸들 스타일 override. */
  resizeHandleStyles?: HandleStyles;
  canvasW: number;
  canvasH: number;
  gridSnapEnabled: boolean;
  /** 드래그 중 스냅 가이드 좌표 dispatch (캔버스 overlay 가 그린다). */
  onSnapGuide: (guide: { guideX: number | null; guideY: number | null }) => void;
  /**
   * 부모 viewport 의 zoom 배율. react-rnd 의 `scale` prop 으로 그대로 전달하면
   * react-rnd 가 내부적으로 dragX/dragY 를 zoom 으로 나눠 design-space 좌표를 유지.
   * 1 = 100% (기본값, viewport wrapper 없는 호출 경로 호환).
   */
  zoom: number;
}

function SlotRnd({
  slot,
  allSlots,
  selected,
  groupMembership,
  onSelect,
  onChange,
  onMoveSlots,
  onDeleteSelected,
  onDuplicateSelected,
  resizeHandleStyles,
  canvasW,
  canvasH,
  gridSnapEnabled,
  onSnapGuide,
  zoom,
}: SlotRndProps) {
  // F11 회전 정책 (MVP):
  //  - rotation 이 0 이 아니면 drag/resize 핸들이 axis-aligned 인 채로 회전된
  //    콘텐츠 위에 떠 있어 사용자에게 혼동을 준다.
  //  - 따라서 회전된 슬롯은 이동/리사이즈를 비활성화하고, 사용자는 우측 패널의
  //    "초기화" 버튼으로 회전을 0 으로 되돌린 뒤 다시 배치한다.
  //  - 회전 자체는 슬라이더/숫자 입력/프리셋으로만 설정 가능 (캔버스에서는 X).
  //
  // 시각화 트릭:
  //  - Rnd 의 outer wrapper 에는 transform 을 절대 두지 않는다 (react-draggable
  //    이 내부적으로 translate 를 쓰므로 충돌 위험). 콘텐츠 영역(SlotPreview)
  //    만 inner div 로 한 번 더 감싸서 그 안에서 transform: rotate 를 적용한다.
  //  - inner wrapper 의 transform-origin: center 로 두어 백엔드 canvas-renderer
  //    의 슬롯 중심 회전과 시각적으로 일치시킨다.
  const rotation = slot.rotation ?? 0;
  const isRotated = rotation !== 0;

  // Phase 2C: locked 슬롯은 회전된 슬롯과 동일하게 drag/resize 비활성.
  // hover 시 상단에 작은 lock 아이콘 overlay 가 뜨고, 우측 패널/툴바에서 잠금 해제 가능.
  const isLocked = slot.locked === true;
  const dragDisabled = isRotated || isLocked;
  const resizeEnabled = !isRotated && !isLocked;

  // 핸들 스타일은 선택된 슬롯에만 적용해서 비선택 슬롯들의 hit-area 가 서로 겹치지
  // 않게 한다 (모바일에서 인접 슬롯끼리 핸들이 겹치면 잘못된 슬롯이 잡힘).
  const handleStyles = selected ? resizeHandleStyles : undefined;

  /**
   * onMouseDown 에서 onSelect 를 호출 — modifier 키를 함께 전달.
   * react-rnd 의 onMouseDown 은 native MouseEvent 를 넘긴다.
   *
   * 우클릭 (button=2) 시에는 이미 선택된 슬롯이면 그대로 두고, 미선택 슬롯이면
   * 단일 선택으로 전환 (Figma 와 동일 — 우클릭이 컨텍스트 메뉴를 띄우기 전 선택).
   */
  const handleMouseDown = (e: MouseEvent) => {
    if (e.button === 2) {
      // 우클릭 — 이미 선택된 슬롯의 일부면 그대로 유지, 아니면 단일 선택으로 전환.
      if (!selected) {
        onSelect();
      }
      return;
    }
    onSelect({
      shiftKey: e.shiftKey,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
    });
  };

  // Phase 2C: 그룹 멤버 — 같은 groupId 슬롯들의 ID 목록.
  // 드래그 시 dx/dy 를 함께 적용할 대상.
  //
  // Phase 2C-5 fix: 같은 그룹의 잠긴(locked) 슬롯은 함께 이동하지 않는다.
  // 잠금은 "이 슬롯은 움직이면 안 됨" 신호이므로 그룹 안에서도 존중되어야 한다.
  // 단, 드래그 중인 슬롯 본인은 dragDisabled 가 true 면 Rnd 자체가 disabled 이므로
  // 여기까지 도달하지 않는다 — 형제 멤버에 대해서만 lock 필터가 의미가 있다.
  const groupMemberIds = useMemo(() => {
    if (!slot.groupId) return [slot.id];
    const members = groupMembership.get(slot.groupId) ?? [slot.id];
    // 잠긴 슬롯 ID lookup (allSlots 에서 locked=true 인 ID 들).
    const lockedIds = new Set<string>();
    for (const s of allSlots) {
      if (s.locked === true) lockedIds.add(s.id);
    }
    // 드래그 시작점인 본인은 항상 포함 (자기 자신 lock 은 Rnd 단계에서 차단됨).
    return members.filter((id) => id === slot.id || !lockedIds.has(id));
  }, [slot.id, slot.groupId, groupMembership, allSlots]);

  // Rnd controlled 모드 — 드래그 중 스냅을 적용하기 위해 position 을 직접 통제.
  // onDrag 가 호출되어도 position prop 을 갱신하지 않으면 React 측 위치는 안 바뀌고
  // 사용자가 드래그를 멈추면 onDragStop 에서 최종 좌표를 반영. 이렇게 하면 drag 중에는
  // react-rnd 내부 transform 만 움직이고, 우리는 가이드만 그린다 (단순 + 안정).
  const handleDrag = (_e: unknown, data: DraggableData) => {
    const snap = computeSnap(slot, data.x, data.y, allSlots, {
      canvasW,
      canvasH,
      gridEnabled: gridSnapEnabled,
      slotEnabled: true,
    });
    onSnapGuide({ guideX: snap.guideX, guideY: snap.guideY });
    // 스냅 결과가 data 와 다르면 react-rnd 에 보정된 좌표를 통보하기 위해 false 를 반환…
    // 하지만 react-rnd 는 onDrag 의 false 반환 시 드래그를 abort 하는 식이라 실시간 보정은
    // onDragStop 에서 최종 좌표만 보정하는 단순 모델로 간다.
    // (라이브 가이드라인은 이미 그려지므로 사용자 인지엔 문제 없음.)
  };

  const handleDragStop = (_e: unknown, data: DraggableData) => {
    const snap = computeSnap(slot, data.x, data.y, allSlots, {
      canvasW,
      canvasH,
      gridEnabled: gridSnapEnabled,
      slotEnabled: true,
    });
    onSnapGuide({ guideX: null, guideY: null });
    // Phase 2C: 그룹 슬롯 함께 이동 — delta 를 모든 멤버에게 적용.
    const dx = snap.x - slot.x;
    const dy = snap.y - slot.y;
    if (dx === 0 && dy === 0) return;
    onMoveSlots(groupMemberIds, dx, dy);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Rnd
          size={{ width: slot.w, height: slot.h }}
          position={{ x: slot.x, y: slot.y }}
          bounds="parent"
          // viewport zoom 보정 — react-rnd 는 scale 을 알면 onDrag/onResize 좌표를 zoom 으로
          // 나눠서 design-space 좌표를 유지한다. 우리가 onDrag delta 를 / zoom 할 필요 없음.
          scale={zoom}
          disableDragging={dragDisabled}
          enableResizing={resizeEnabled}
          resizeHandleStyles={handleStyles}
          onMouseDown={handleMouseDown}
          onDragStart={() => {
            if (!selected) onSelect();
          }}
          onDrag={handleDrag}
          onDragStop={handleDragStop}
          onResizeStart={() => {
            if (!selected) onSelect();
          }}
          onResizeStop={(_e, _dir, ref, _delta, position) => {
            onChange({
              x: Math.round(position.x),
              y: Math.round(position.y),
              w: Math.max(1, Math.round(ref.offsetWidth)),
              h: Math.max(1, Math.round(ref.offsetHeight)),
            });
          }}
          className={cn(
            "transition-shadow group",
            selected
              ? "ring-2 ring-primary shadow-[0_0_0_2px_rgba(0,0,0,0.1)]"
              : "ring-1 ring-dashed ring-primary/50 hover:ring-primary/80",
            isLocked && "cursor-not-allowed",
          )}
          data-locked={isLocked ? "true" : "false"}
          data-group-id={slot.groupId ?? ""}
        >
          <div
            data-testid={`slot-rotation-wrapper-${slot.id}`}
            data-rotated={isRotated ? "true" : "false"}
            className="h-full w-full"
            style={{
              transform: isRotated ? `rotate(${rotation}deg)` : undefined,
              transformOrigin: "center",
            }}
          >
            <SlotPreview slot={slot} />
          </div>
          {isLocked ? (
            <div
              className="pointer-events-none absolute -top-1 -right-1 rounded-full bg-foreground/85 p-1 text-background shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
              data-testid={`slot-lock-overlay-${slot.id}`}
              aria-hidden="true"
            >
              <Lock className="size-3" />
            </div>
          ) : null}
          {isRotated && selected ? (
            <div
              className="pointer-events-none absolute -bottom-7 left-0 right-0 mx-auto w-max max-w-full rounded-md bg-foreground/85 px-2 py-1 text-[10px] text-background shadow-sm"
              data-testid={`slot-rotation-hint-${slot.id}`}
            >
              회전된 슬롯은 회전을 초기화한 후 이동/크기 조정 가능
            </div>
          ) : null}
        </Rnd>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => onDeleteSelected()}>
          삭제
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onDuplicateSelected()}>
          복제
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled>잠금 (준비 중)</ContextMenuItem>
        <ContextMenuItem disabled>숨김 (준비 중)</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * 슬롯 내용 시각 근사. 실제 서버 렌더와 1:1 보장이 아니라 "배치 확인" 용도.
 */
function SlotPreview({ slot }: { slot: TemplateSlot }) {
  if (slot.type === "text") {
    return <TextSlotPreview slot={slot} />;
  }
  return <ImageSlotPreview slot={slot} />;
}

function TextSlotPreview({ slot }: { slot: TextSlot }) {
  const display = slot.binding
    ? `{{ ${slot.binding} }}`
    : slot.literal ?? "";
  return (
    <div
      className="h-full w-full overflow-hidden bg-white/0"
      style={{
        fontFamily: "Pretendard, system-ui, sans-serif",
        fontWeight: slot.font.weight,
        fontSize: `${slot.font.size}px`,
        color: slot.font.color,
        textAlign: slot.font.align,
        lineHeight: slot.font.lineHeight ?? 1.2,
        display: "flex",
        alignItems: "flex-start",
        justifyContent:
          slot.font.align === "center"
            ? "center"
            : slot.font.align === "right"
              ? "flex-end"
              : "flex-start",
      }}
    >
      <span
        style={{
          display: "-webkit-box",
          WebkitLineClamp: slot.font.maxLines ?? 1,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          wordBreak: "break-word",
          width: "100%",
        }}
      >
        {display || "(빈 텍스트)"}
      </span>
    </div>
  );
}

function ImageSlotPreview({ slot }: { slot: ImageSlot }) {
  const url = slot.fallbackUrl || "";
  const radius = slot.borderRadius ?? 0;

  return (
    <div
      className="h-full w-full overflow-hidden bg-muted/70 flex items-center justify-center text-[10px] text-muted-foreground"
      style={{ borderRadius: `${radius}px` }}
    >
      {url ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={url}
          alt={slot.binding ?? "이미지 슬롯"}
          className="h-full w-full"
          style={{ objectFit: slot.fit }}
          draggable={false}
        />
      ) : (
        <span className="px-1 text-center">
          {slot.binding ? `{{ ${slot.binding} }}` : "이미지"}
        </span>
      )}
    </div>
  );
}

// `DEFAULT_GRID_SIZE` re-export — 헤더 토글에서 라벨용으로 가져갈 수 있게.
export { DEFAULT_GRID_SIZE };
