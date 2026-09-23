"use client";

import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import type {
  ScheduleTemplate,
} from "@/meloming/domains/schedule-template/types";
import type {
  TemplateSlot,
  TemplateSpecV1,
} from "@/meloming/domains/schedule-template/types/template-spec";
import type {
  AlignKind,
  DistributeKind,
} from "@/meloming/domains/schedule-template/utils/align-slots";
import type { ToolId } from "../tools/tool-types";
import type { HistoryEntry } from "./use-editor-history";

/**
 * Photoshop 에디터 단일 진실의 원천.
 *
 * `<PhotoshopEditor>` 가 하나의 큰 hook 으로 모든 상태/액션을 만든 뒤,
 * 이 context 로 깊은 자식 (각 패널/도구/캔버스) 에 전달한다.
 *
 * 1) state slice — 에디터 데이터/UI 상태 (최소 필드)
 * 2) selection — 선택된 슬롯 ID 들
 * 3) tool — 활성 도구
 * 4) history — undo/redo + 히스토리 패널
 * 5) actions — 슬롯 조작 dispatcher
 * 6) viewport — 줌/팬 (캔버스 viewport 가 직접 보유, 일부만 expose)
 */
export interface EditorContextValue {
  // --- 메타 ---
  template: ScheduleTemplate;
  listHref: string;

  // --- 데이터 상태 ---
  name: string;
  isDefault: boolean;
  spec: TemplateSpecV1;
  /** 마지막 서버 저장 대비 dirty 여부. */
  dirty: boolean;
  saving: boolean;

  // --- 선택 상태 ---
  selectedSlotIds: string[];
  /** 단일 선택일 때만 정의 — 패널이 단일/다중 분기 안 해도 되게 helper. */
  singleSelectedSlot: TemplateSlot | null;

  // --- 도구 ---
  activeTool: ToolId;
  setActiveTool: (tool: ToolId) => void;

  // --- 히스토리 ---
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  historyEntries: HistoryEntry<unknown>[];
  /** 현재 present 가 entries 의 몇 번째 인지. */
  historyCurrentIndex: number;
  jumpToHistory: (index: number) => void;

  // --- UI 상태 ---
  gridSnapEnabled: boolean;
  setGridSnapEnabled: (next: boolean) => void;
  /** 색상 패널의 현재 활성 색상 (foreground). */
  foregroundColor: string;
  setForegroundColor: (color: string) => void;
  /** 캔버스 위 마우스 커서 좌표 (design-space px). 캔버스 외부면 null. */
  cursorPos: { x: number; y: number } | null;
  setCursorPos: (pos: { x: number; y: number } | null) => void;
  /** 캔버스 viewport 의 현재 줌 % (상태바 표시용). */
  zoomPercent: number;
  setZoomPercent: (percent: number) => void;

  // --- 메타 액션 ---
  setName: (next: string) => void;
  setIsDefault: (next: boolean) => void;
  save: () => Promise<void>;
  revert: () => void;

  // --- 슬롯 액션 ---
  selectSlot: (id: string, modifiers?: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }) => void;
  selectMany: (ids: string[]) => void;
  deselectAll: () => void;
  selectAll: () => void;
  cycleNextSlot: () => void;
  cyclePrevSlot: () => void;

  patchSlot: (id: string, patch: Partial<TemplateSlot>, opts?: { coalesceKey?: string; label?: string }) => void;
  moveSlots: (ids: string[], dx: number, dy: number, coalesceKey?: string) => void;

  addText: () => void;
  addImage: () => void;
  /** 사각형 도형 슬롯 — 현재는 fallbackUrl 비어있는 ImageSlot 으로 placeholder. */
  addRectangle: () => void;

  deleteSelected: () => void;
  duplicateSelected: () => void;

  alignSelected: (kind: AlignKind) => void;
  distributeSelected: (kind: DistributeKind) => void;

  reorderSlots: (next: TemplateSlot[]) => void;
  /** 단일 슬롯 z-order (Photoshop: 위로/아래로). */
  bringForward: (id: string) => void;
  sendBackward: (id: string) => void;
  bringToFront: (id: string) => void;
  sendToBack: (id: string) => void;

  toggleLocked: (id: string) => void;
  toggleHidden: (id: string) => void;
  setLocked: (value: boolean) => void;
  setHidden: (value: boolean) => void;
  groupSelected: () => void;
  ungroupSelected: () => void;
  renameSlot: (id: string, name: string) => void;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export interface EditorProviderProps {
  value: EditorContextValue;
  children: ReactNode;
}

export function EditorProvider({ value, children }: EditorProviderProps) {
  return (
    <EditorContext.Provider value={value}>{children}</EditorContext.Provider>
  );
}

export function useEditorContext(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) {
    throw new Error("useEditorContext must be used inside <EditorProvider>");
  }
  return ctx;
}
