"use client";

import { useEditorContext } from "../state/editor-context";

interface StatusBarProps {
  zoomPercent: number;
  cursorX: number | null;
  cursorY: number | null;
}

/**
 * Photoshop 하단 상태바.
 *
 * 좌측: 줌 % / 캔버스 크기
 * 우측: 마우스 좌표 (design-space px) / 슬롯 개수 / 선택 상태
 */
export function StatusBar({ zoomPercent, cursorX, cursorY }: StatusBarProps) {
  const ctx = useEditorContext();
  const slotCount = ctx.spec.slots.length;
  const visibleCount = ctx.spec.slots.filter((s) => s.hidden !== true).length;

  return (
    <div
      data-photoshop-statusbar
      className="flex items-center justify-between px-3 border-t text-[11px] shrink-0 select-none tabular-nums"
      style={{
        height: "var(--ps-status-bar-height)",
        background: "var(--ps-bg)",
        borderColor: "var(--ps-divider)",
        color: "var(--ps-text-muted)",
      }}
    >
      <div className="flex items-center gap-3">
        <span>{zoomPercent}%</span>
        <span style={{ color: "var(--ps-border)" }}>·</span>
        <span>
          {ctx.template.baseImageW} × {ctx.template.baseImageH}px
        </span>
      </div>
      <div className="flex items-center gap-3">
        {cursorX !== null && cursorY !== null && (
          <>
            <span>X: {Math.round(cursorX)}</span>
            <span>Y: {Math.round(cursorY)}</span>
            <span style={{ color: "var(--ps-border)" }}>·</span>
          </>
        )}
        <span>
          레이어 {visibleCount}/{slotCount}
        </span>
        {ctx.selectedSlotIds.length > 0 && (
          <>
            <span style={{ color: "var(--ps-border)" }}>·</span>
            <span style={{ color: "var(--ps-text)" }}>
              {ctx.selectedSlotIds.length}개 선택됨
            </span>
          </>
        )}
      </div>
    </div>
  );
}
