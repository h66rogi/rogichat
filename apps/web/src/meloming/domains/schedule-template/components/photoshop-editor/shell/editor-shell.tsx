"use client";

import { useEditorContext } from "../state/editor-context";
import { MenuBar } from "./menu-bar";
import { OptionsBar } from "../options-bar/options-bar";
import { ToolPalette } from "../tools/tool-palette";
import { PhotoshopCanvas } from "../canvas/photoshop-canvas";
import { PanelDock } from "./panel-dock";
import { StatusBar } from "./status-bar";

/**
 * Photoshop 에디터의 최상위 레이아웃.
 *
 *   ┌───────────────────────────────────────┐
 *   │ 메뉴바 (File/Edit/Layer/Select/View)  │
 *   ├───────────────────────────────────────┤
 *   │ 옵션바 (활성 도구별)                   │
 *   ├──┬────────────────────────┬──────────┤
 *   │도│                        │ 패널 도크 │
 *   │구│       캔버스           │  (속성/  │
 *   │팔│                        │   문자/   │
 *   │레│                        │   레이어/│
 *   │트│                        │   히스토리│
 *   │  │                        │   /색상)  │
 *   ├──┴────────────────────────┴──────────┤
 *   │ 상태바 (zoom / 좌표 / 슬롯 수)         │
 *   └───────────────────────────────────────┘
 */
export function EditorShell() {
  const ctx = useEditorContext();
  return (
    <div
      data-photoshop-editor="true"
      className="flex flex-col h-[calc(100dvh-4rem)] md:h-[calc(100dvh-24px)] overflow-hidden"
    >
      <MenuBar />
      <OptionsBar />
      <div className="flex flex-1 min-h-0 min-w-0">
        <ToolPalette />
        <PhotoshopCanvas />
        <PanelDock />
      </div>
      <StatusBar
        zoomPercent={ctx.zoomPercent}
        cursorX={ctx.cursorPos?.x ?? null}
        cursorY={ctx.cursorPos?.y ?? null}
      />
    </div>
  );
}
