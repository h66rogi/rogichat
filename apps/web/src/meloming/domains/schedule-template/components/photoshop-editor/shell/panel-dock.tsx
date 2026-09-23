"use client";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/meloming/shared/components/ui/resizable";
import { LayersPanel } from "../panels/layers-panel";
import { PropertiesPanel } from "../panels/properties-panel";
import { CharacterPanel } from "../panels/character-panel";
import { ParagraphPanel } from "../panels/paragraph-panel";
import { HistoryPanel } from "../panels/history-panel";
import { ColorPanel } from "../panels/color-panel";

/**
 * Photoshop 우측 패널 도크.
 *
 * 위에서부터 아래로 세로 분할:
 *   [속성 / 색상 (탭 또는 split)]
 *   [문자 / 단락 (탭)]
 *   [레이어 / 히스토리 (탭)]
 *
 * MVP 는 simple stack — Photoshop 의 docking flexibility 는 차후 확장.
 * 사용자가 가장 자주 보는 Layers / Properties 가 가장 큰 영역 차지.
 */
export function PanelDock() {
  return (
    <aside
      data-photoshop-panel-dock
      className="flex flex-col shrink-0 border-l h-full"
      style={{
        width: 320,
        background: "var(--ps-bg-panel)",
        borderColor: "var(--ps-divider)",
      }}
    >
      <ResizablePanelGroup direction="vertical">
        <ResizablePanel defaultSize={20} minSize={10}>
          <PropertiesPanel />
        </ResizablePanel>
        <ResizableHandle className="bg-[var(--ps-divider)] hover:bg-[var(--ps-accent)]" />
        <ResizablePanel defaultSize={26} minSize={10}>
          <CharacterPanel />
        </ResizablePanel>
        <ResizableHandle className="bg-[var(--ps-divider)] hover:bg-[var(--ps-accent)]" />
        <ResizablePanel defaultSize={9} minSize={6}>
          <ParagraphPanel />
        </ResizablePanel>
        <ResizableHandle className="bg-[var(--ps-divider)] hover:bg-[var(--ps-accent)]" />
        <ResizablePanel defaultSize={15} minSize={8}>
          <ColorPanel />
        </ResizablePanel>
        <ResizableHandle className="bg-[var(--ps-divider)] hover:bg-[var(--ps-accent)]" />
        <ResizablePanel defaultSize={20} minSize={10}>
          <LayersPanel />
        </ResizablePanel>
        <ResizableHandle className="bg-[var(--ps-divider)] hover:bg-[var(--ps-accent)]" />
        <ResizablePanel defaultSize={10} minSize={6}>
          <HistoryPanel />
        </ResizablePanel>
      </ResizablePanelGroup>
    </aside>
  );
}
