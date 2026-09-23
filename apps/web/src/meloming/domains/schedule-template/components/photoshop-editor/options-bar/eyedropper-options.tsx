"use client";

import { useEditorContext } from "../state/editor-context";

export function EyedropperOptions() {
  const ctx = useEditorContext();
  return (
    <>
      <span className="ps-label">샘플:</span>
      <span className="text-[11px] text-[var(--ps-text-muted)]">
        캔버스를 클릭해 색을 추출합니다 (현재 베이스 이미지 기반)
      </span>
      <span className="ps-vsep" />
      <span className="ps-label">현재:</span>
      <span
        className="size-5 rounded-sm border"
        style={{
          background: ctx.foregroundColor,
          borderColor: "var(--ps-border-strong)",
        }}
      />
      <span className="text-[11px] font-mono">{ctx.foregroundColor}</span>
    </>
  );
}
