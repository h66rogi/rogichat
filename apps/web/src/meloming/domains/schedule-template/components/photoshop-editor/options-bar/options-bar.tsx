"use client";

import { useEditorContext } from "../state/editor-context";
import { MoveOptions } from "./move-options";
import { TypeOptions } from "./type-options";
import { ShapeOptions } from "./shape-options";
import { ZoomOptions } from "./zoom-options";
import { MarqueeOptions } from "./marquee-options";
import { EyedropperOptions } from "./eyedropper-options";

/**
 * Photoshop 상단 옵션 바.
 *
 * 활성 도구에 따라 다른 컨트롤 보여줌. 모든 옵션은 인라인 렌더 — Photoshop 도 같은 패턴.
 * 비어있을 때도 bar 자체는 유지 (높이 변동 방지).
 */
export function OptionsBar() {
  const ctx = useEditorContext();
  const tool = ctx.activeTool;

  return (
    <div
      data-photoshop-options-bar
      className="flex items-center px-3 gap-2 border-b shrink-0 overflow-x-auto"
      style={{
        height: "var(--ps-options-bar-height)",
        background: "var(--ps-bg-elevated)",
        borderColor: "var(--ps-divider)",
      }}
    >
      {tool === "move" && <MoveOptions />}
      {tool === "marquee" && <MarqueeOptions />}
      {tool === "type" && <TypeOptions />}
      {tool === "rectangle" && <ShapeOptions />}
      {tool === "image" && <ImageOptionsHint />}
      {tool === "eyedropper" && <EyedropperOptions />}
      {(tool === "hand" || tool === "zoom") && <ZoomOptions />}
      {tool === "crop" && <span className="text-[11px] text-[var(--ps-text-muted)]">자르기 도구는 준비 중입니다.</span>}
    </div>
  );
}

function ImageOptionsHint() {
  return (
    <span className="text-[11px] text-[var(--ps-text-muted)]">
      캔버스를 클릭해 이미지 슬롯을 추가
    </span>
  );
}
