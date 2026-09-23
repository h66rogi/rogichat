"use client";

import { useCallback, useEffect, useRef, type CSSProperties, type MouseEvent } from "react";
import { useEditorContext } from "../state/editor-context";
import { TOOL_BY_ID } from "../tools/tool-types";
import { useToolCanvasClick } from "../tools/use-tool-canvas-click";
import { ScheduleTemplateCanvasViewport } from "../../editor/schedule-template-canvas-viewport";
import { ScheduleTemplateEditorCanvas } from "../../editor/schedule-template-editor-canvas";

/**
 * 캔버스 영역 — 기존 ScheduleTemplateCanvasViewport + ScheduleTemplateEditorCanvas 재사용.
 *
 * 추가 책임:
 *  - 활성 도구에 따른 cursor 변경 (tool.cursor)
 *  - 마우스 hover 시 design-space 좌표를 context.cursorPos 로 전송 (status bar 표시)
 *  - 활성 도구별 캔버스 클릭 dispatch (Type/Image/Rectangle/Eyedropper)
 */
export function PhotoshopCanvas() {
  const ctx = useEditorContext();
  const {
    template,
    spec,
    selectedSlotIds,
    activeTool,
    foregroundColor,
    setForegroundColor,
    setCursorPos,
    setZoomPercent,
  } = ctx;
  const tool = TOOL_BY_ID[activeTool];

  const { handleBackgroundClick } = useToolCanvasClick({
    activeTool,
    baseImageUrl: template.baseImageUrl,
    baseImageW: template.baseImageW,
    baseImageH: template.baseImageH,
    foregroundColor,
    setForegroundColor,
    addSlot: useCallback(
      (slot, label) => {
        // editor-history 의 setState 를 직접 부르지 않고 context 액션을 조합.
        ctx.patchSlot;
        // editor-context 에 직접적인 "addSlot(slot)" 메서드는 없지만 patchSlot 으로 추가 X.
        // 대신 spec 을 통째로 업데이트하는 reorderSlots 로 새 슬롯을 끝에 push.
        const next = [...ctx.spec.slots, slot];
        ctx.reorderSlots(next);
        ctx.selectMany([slot.id]);
        void label;
      },
      [ctx],
    ),
  });

  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onLeave = () => setCursorPos(null);
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("mouseleave", onLeave);
    return () => el.removeEventListener("mouseleave", onLeave);
  }, [setCursorPos]);

  return (
    <main
      ref={containerRef}
      className="flex-1 min-w-0 ps-canvas-area"
      data-photoshop-canvas-area
      style={{ cursor: tool.cursor } as CSSProperties}
    >
      <ScheduleTemplateCanvasViewport
        contentW={template.baseImageW}
        contentH={template.baseImageH}
      >
        {(zoom) => (
          <ZoomReporter zoom={zoom} setZoomPercent={setZoomPercent}>
            <CursorTracker setCursorPos={setCursorPos}>
              <ScheduleTemplateEditorCanvas
                baseImageUrl={template.baseImageUrl}
                baseImageW={template.baseImageW}
                baseImageH={template.baseImageH}
                slots={spec.slots}
                selectedIds={selectedSlotIds}
                onSelect={(id, mods) => ctx.selectSlot(id, mods)}
                onDeselect={() => ctx.deselectAll()}
                onMarqueeSelect={(ids) => ctx.selectMany(ids)}
                onSlotChange={(id, patch) =>
                  ctx.patchSlot(id, patch, {
                    coalesceKey: `slot-change:${id}`,
                    label: "슬롯 변경",
                  })
                }
                onSlotsMove={(ids: string[], dx: number, dy: number) =>
                  ctx.moveSlots(ids, dx, dy)
                }
                onDeleteSelected={() => ctx.deleteSelected()}
                onDuplicateSelected={() => ctx.duplicateSelected()}
                gridSnapEnabled={ctx.gridSnapEnabled}
                zoom={zoom}
                showHeader={false}
                onBackgroundClick={(x, y) => handleBackgroundClick(x, y)}
              />
            </CursorTracker>
          </ZoomReporter>
        )}
      </ScheduleTemplateCanvasViewport>
    </main>
  );
}

function ZoomReporter({
  zoom,
  setZoomPercent,
  children,
}: {
  zoom: number;
  setZoomPercent: (p: number) => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    setZoomPercent(Math.round(zoom * 100));
  }, [zoom, setZoomPercent]);
  return <>{children}</>;
}

function CursorTracker({
  setCursorPos,
  children,
}: {
  setCursorPos: (p: { x: number; y: number } | null) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || !ref.current) return;
    const scaleX = rect.width === 0 ? 1 : rect.width / Math.max(1, ref.current.offsetWidth);
    const x = (e.clientX - rect.left) / scaleX;
    const y = (e.clientY - rect.top) / scaleX;
    setCursorPos({ x, y });
  };

  return (
    <div ref={ref} onMouseMove={onMove} className="contents">
      {children}
    </div>
  );
}
