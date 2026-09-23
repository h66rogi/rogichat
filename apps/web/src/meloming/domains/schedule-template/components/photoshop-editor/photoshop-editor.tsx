"use client";

import { notFound } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { extractApiErrorMessage } from "@/meloming/shared/lib/api-error";
import { useFeatureFlag } from "@/meloming/shared/hooks/use-feature-flag";
import { useUnsavedChangesWarning } from "@/meloming/shared/hooks/use-unsaved-changes-warning";
import {
  useScheduleTemplate,
  useUpdateScheduleTemplate,
} from "@/meloming/domains/schedule-template/hooks";
import type { ScheduleTemplate } from "@/meloming/domains/schedule-template/types";
import type {
  TemplateSlot,
  TemplateSpecV1,
} from "@/meloming/domains/schedule-template/types/template-spec";
import {
  alignSlots,
  distributeSlots,
  type AlignKind,
  type DistributeKind,
} from "@/meloming/domains/schedule-template/utils/align-slots";
import {
  applyMoveDelta,
  createGroupId,
  expandGroupMembers,
  expandSelectionWithGroups,
} from "@/meloming/domains/schedule-template/utils/slot-groups";
import {
  coerceTemplateSpec,
  createDefaultImageSlot,
  createDefaultTextSlot,
  updateSlotById,
} from "../editor/default-slots";
import {
  EditorError,
  EditorLoading,
} from "../editor/schedule-template-editor-states";
import { EditorProvider, type EditorContextValue } from "./state/editor-context";
import { useEditorHistory } from "./state/use-editor-history";
import { useTool } from "./tools/use-tool";
import { EditorShell } from "./shell/editor-shell";
import "./photoshop-editor.css";

interface ScheduleEditorState {
  name: string;
  isDefault: boolean;
  spec: TemplateSpecV1;
}

const EMPTY_STATE: ScheduleEditorState = {
  name: "",
  isDefault: false,
  spec: { version: 1, slots: [] },
};

interface PhotoshopEditorProps {
  user: string;
  templateId: number;
}

/**
 * Photoshop 스타일 시간표 템플릿 에디터 (전면 재설계).
 *
 * 기존 ScheduleTemplateEditor 와 동일한 책임 + 데이터 모델을 공유하되,
 * UI/UX 를 Photoshop UI 에 맞춰 재구성:
 *   - 다크 테마 + Photoshop 레이아웃 (메뉴바 / 옵션바 / 도구 팔레트 / 캔버스 / 패널 도크 / 상태바)
 *   - 활성 도구 (Move/Type/Image 등) 가 캔버스 동작과 옵션바를 좌우
 *   - 레이어 패널 (썸네일 / blend mode / 불투명도 / 잠금 variants / 그룹 폴더)
 *   - 문자/단락/속성/색상/히스토리 패널
 *
 * 데이터 호환성:
 *   - 기존 V1 templateSpec 그대로 사용. opacity/blendMode/letterSpacing 등 V2 필드는
 *     모두 optional 추가라 backward compat. 백엔드 렌더러도 V2 필드를 인식.
 */
export function PhotoshopEditor({ user, templateId }: PhotoshopEditorProps) {
  const flagEnabled = useFeatureFlag("channelScheduleTemplate");
  const listHref = `/channel/${user}/manage/schedule-templates`;

  if (!flagEnabled) {
    notFound();
  }

  return <Body templateId={templateId} listHref={listHref} />;
}

function Body({
  templateId,
  listHref,
}: {
  templateId: number;
  listHref: string;
}) {
  const {
    data: template,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useScheduleTemplate(templateId);
  const updateMutation = useUpdateScheduleTemplate();

  const editor = useEditorHistory<ScheduleEditorState>(EMPTY_STATE);
  const { name, isDefault, spec } = editor.state;

  const [selectedSlotIds, setSelectedSlotIds] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [gridSnapEnabled, setGridSnapEnabled] = useState(true);
  const [foregroundColor, setForegroundColor] = useState("#000000");
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [zoomPercent, setZoomPercent] = useState(100);

  const { activeTool, setActiveTool } = useTool();

  // 서버 → 로컬 초기 동기화.
  useEffect(() => {
    if (!template || initialized) return;
    const coerced = coerceTemplateSpec(template.templateSpec);
    editor.reset(
      {
        name: template.name,
        isDefault: template.isDefault,
        spec: coerced,
      },
      "초기 로드",
    );
    setInitialized(true);
    if (coerced.slots.length > 0) {
      setSelectedSlotIds([coerced.slots[0].id]);
    }
  }, [template, initialized, editor]);

  const dirty = useMemo(() => {
    if (!template || !initialized) return false;
    if (name !== template.name) return true;
    if (isDefault !== template.isDefault) return true;
    const serverSpec = coerceTemplateSpec(template.templateSpec);
    return JSON.stringify(serverSpec) !== JSON.stringify(spec);
  }, [template, initialized, name, isDefault, spec]);

  useUnsavedChangesWarning(dirty);

  const singleSelectedSlot = useMemo(() => {
    if (selectedSlotIds.length !== 1) return null;
    return spec.slots.find((s) => s.id === selectedSlotIds[0]) ?? null;
  }, [spec.slots, selectedSlotIds]);

  // ─────────────── 액션들 ───────────────

  const setName = useCallback(
    (next: string) => {
      editor.setState((prev) => ({ ...prev, name: next }), {
        coalesce: "name",
        label: "이름 변경",
      });
    },
    [editor],
  );

  const setIsDefault = useCallback(
    (next: boolean) => {
      editor.setState((prev) => ({ ...prev, isDefault: next }), {
        label: next ? "기본 템플릿 설정" : "기본 템플릿 해제",
      });
    },
    [editor],
  );

  const selectSlot = useCallback(
    (
      id: string,
      modifiers?: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean },
    ) => {
      const additive =
        modifiers?.shiftKey || modifiers?.metaKey || modifiers?.ctrlKey;
      const expanded = expandGroupMembers(spec.slots, id);
      setSelectedSlotIds((prev) => {
        if (additive) {
          if (prev.includes(id)) {
            const removeSet = new Set(expanded);
            return prev.filter((x) => !removeSet.has(x));
          }
          const union = new Set(prev);
          for (const x of expanded) union.add(x);
          return Array.from(union);
        }
        return expanded;
      });
    },
    [spec.slots],
  );

  const selectMany = useCallback(
    (ids: string[]) => {
      setSelectedSlotIds(expandSelectionWithGroups(spec.slots, ids));
    },
    [spec.slots],
  );

  const deselectAll = useCallback(() => setSelectedSlotIds([]), []);

  const selectAll = useCallback(() => {
    setSelectedSlotIds(
      spec.slots.filter((s) => s.hidden !== true).map((s) => s.id),
    );
  }, [spec.slots]);

  const cycleNextSlot = useCallback(() => {
    if (spec.slots.length === 0) return;
    const candidates: number[] = [];
    spec.slots.forEach((s, i) => {
      if (s.hidden !== true && s.locked !== true) candidates.push(i);
    });
    if (candidates.length === 0) return;
    const sel = new Set(selectedSlotIds);
    let start = -1;
    spec.slots.forEach((s, i) => {
      if (sel.has(s.id)) start = Math.max(start, i);
    });
    const next = candidates.find((i) => i > start) ?? candidates[0];
    setSelectedSlotIds([spec.slots[next].id]);
  }, [spec.slots, selectedSlotIds]);

  const cyclePrevSlot = useCallback(() => {
    if (spec.slots.length === 0) return;
    const candidates: number[] = [];
    spec.slots.forEach((s, i) => {
      if (s.hidden !== true && s.locked !== true) candidates.push(i);
    });
    if (candidates.length === 0) return;
    const sel = new Set(selectedSlotIds);
    let start = spec.slots.length;
    spec.slots.forEach((s, i) => {
      if (sel.has(s.id)) start = Math.min(start, i);
    });
    const reversed = [...candidates].reverse();
    const prev = reversed.find((i) => i < start) ?? candidates[candidates.length - 1];
    setSelectedSlotIds([spec.slots[prev].id]);
  }, [spec.slots, selectedSlotIds]);

  const patchSlot = useCallback(
    (
      id: string,
      patch: Partial<TemplateSlot>,
      opts?: { coalesceKey?: string; label?: string },
    ) => {
      editor.setState(
        (prev) => ({
          ...prev,
          spec: {
            version: 1,
            slots: updateSlotById(prev.spec.slots, id, patch),
          },
        }),
        {
          coalesce: opts?.coalesceKey,
          label: opts?.label ?? "슬롯 편집",
        },
      );
    },
    [editor],
  );

  const moveSlots = useCallback(
    (ids: string[], dx: number, dy: number, coalesceKey?: string) => {
      if (ids.length === 0 || (dx === 0 && dy === 0)) return;
      editor.setState(
        (prev) => ({
          ...prev,
          spec: {
            version: 1,
            slots: applyMoveDelta(prev.spec.slots, ids, dx, dy),
          },
        }),
        {
          coalesce: coalesceKey,
          label: ids.length > 1 ? "여러 슬롯 이동" : "이동",
        },
      );
    },
    [editor],
  );

  const addText = useCallback(() => {
    const slot = createDefaultTextSlot();
    if (foregroundColor) {
      slot.font.color = foregroundColor;
    }
    editor.setState(
      (prev) => ({
        ...prev,
        spec: { version: 1, slots: [...prev.spec.slots, slot] },
      }),
      { label: "텍스트 레이어 추가" },
    );
    setSelectedSlotIds([slot.id]);
    setActiveTool("type");
  }, [editor, setActiveTool, foregroundColor]);

  const addImage = useCallback(() => {
    const slot = createDefaultImageSlot();
    editor.setState(
      (prev) => ({
        ...prev,
        spec: { version: 1, slots: [...prev.spec.slots, slot] },
      }),
      { label: "이미지 레이어 추가" },
    );
    setSelectedSlotIds([slot.id]);
    setActiveTool("move");
  }, [editor, setActiveTool]);

  const addRectangle = useCallback(() => {
    // V1 데이터 모델에는 도형 타입이 없으므로 ImageSlot (fallback 빈) + borderRadius 0 으로 placeholder.
    const slot = createDefaultImageSlot();
    slot.fit = "fill";
    editor.setState(
      (prev) => ({
        ...prev,
        spec: { version: 1, slots: [...prev.spec.slots, slot] },
      }),
      { label: "사각형 추가" },
    );
    setSelectedSlotIds([slot.id]);
    setActiveTool("rectangle");
  }, [editor, setActiveTool]);

  const deleteSelected = useCallback(() => {
    if (selectedSlotIds.length === 0) return;
    const idSet = new Set(selectedSlotIds);
    editor.setState(
      (prev) => ({
        ...prev,
        spec: {
          version: 1,
          slots: prev.spec.slots.filter((s) => !idSet.has(s.id)),
        },
      }),
      { label: "삭제" },
    );
    setSelectedSlotIds([]);
  }, [editor, selectedSlotIds]);

  const duplicateSelected = useCallback(() => {
    if (selectedSlotIds.length === 0) return;
    const idSet = new Set(selectedSlotIds);
    const newIds: string[] = [];
    editor.setState(
      (prev) => {
        const additions: TemplateSlot[] = [];
        for (const slot of prev.spec.slots) {
          if (!idSet.has(slot.id)) continue;
          const newId = `${slot.id}-copy-${Math.random().toString(36).slice(2, 7)}`;
          newIds.push(newId);
          additions.push({
            ...slot,
            id: newId,
            x: slot.x + 10,
            y: slot.y + 10,
          } as TemplateSlot);
        }
        return {
          ...prev,
          spec: {
            version: 1,
            slots: [...prev.spec.slots, ...additions],
          },
        };
      },
      { label: "복제" },
    );
    setSelectedSlotIds(newIds);
  }, [editor, selectedSlotIds]);

  const alignSelected = useCallback(
    (kind: AlignKind) => {
      if (selectedSlotIds.length < 2) return;
      const idSet = new Set(selectedSlotIds);
      editor.setState(
        (prev) => {
          const target = prev.spec.slots.filter((s) => idSet.has(s.id));
          const aligned = alignSlots(target, kind);
          const byId = new Map(aligned.map((s) => [s.id, s]));
          return {
            ...prev,
            spec: {
              version: 1,
              slots: prev.spec.slots.map((s) => byId.get(s.id) ?? s),
            },
          };
        },
        { label: `정렬: ${kind}` },
      );
    },
    [editor, selectedSlotIds],
  );

  const distributeSelected = useCallback(
    (kind: DistributeKind) => {
      if (selectedSlotIds.length < 3) return;
      const idSet = new Set(selectedSlotIds);
      editor.setState(
        (prev) => {
          const target = prev.spec.slots.filter((s) => idSet.has(s.id));
          const distributed = distributeSlots(target, kind);
          const byId = new Map(distributed.map((s) => [s.id, s]));
          return {
            ...prev,
            spec: {
              version: 1,
              slots: prev.spec.slots.map((s) => byId.get(s.id) ?? s),
            },
          };
        },
        { label: `분배: ${kind}` },
      );
    },
    [editor, selectedSlotIds],
  );

  const reorderSlots = useCallback(
    (next: TemplateSlot[]) => {
      editor.setState(
        (prev) => ({ ...prev, spec: { version: 1, slots: next } }),
        { label: "레이어 순서 변경" },
      );
    },
    [editor],
  );

  const bringForward = useCallback(
    (id: string) => {
      editor.setState(
        (prev) => {
          const idx = prev.spec.slots.findIndex((s) => s.id === id);
          if (idx === -1 || idx === prev.spec.slots.length - 1) return prev;
          const next = [...prev.spec.slots];
          const [m] = next.splice(idx, 1);
          next.splice(idx + 1, 0, m);
          return { ...prev, spec: { version: 1, slots: next } };
        },
        { label: "앞으로" },
      );
    },
    [editor],
  );

  const sendBackward = useCallback(
    (id: string) => {
      editor.setState(
        (prev) => {
          const idx = prev.spec.slots.findIndex((s) => s.id === id);
          if (idx <= 0) return prev;
          const next = [...prev.spec.slots];
          const [m] = next.splice(idx, 1);
          next.splice(idx - 1, 0, m);
          return { ...prev, spec: { version: 1, slots: next } };
        },
        { label: "뒤로" },
      );
    },
    [editor],
  );

  const bringToFront = useCallback(
    (id: string) => {
      editor.setState(
        (prev) => {
          const idx = prev.spec.slots.findIndex((s) => s.id === id);
          if (idx === -1 || idx === prev.spec.slots.length - 1) return prev;
          const next = [...prev.spec.slots];
          const [m] = next.splice(idx, 1);
          next.push(m);
          return { ...prev, spec: { version: 1, slots: next } };
        },
        { label: "맨 앞으로" },
      );
    },
    [editor],
  );

  const sendToBack = useCallback(
    (id: string) => {
      editor.setState(
        (prev) => {
          const idx = prev.spec.slots.findIndex((s) => s.id === id);
          if (idx <= 0) return prev;
          const next = [...prev.spec.slots];
          const [m] = next.splice(idx, 1);
          next.unshift(m);
          return { ...prev, spec: { version: 1, slots: next } };
        },
        { label: "맨 뒤로" },
      );
    },
    [editor],
  );

  const toggleLocked = useCallback(
    (id: string) => {
      editor.setState(
        (prev) => ({
          ...prev,
          spec: {
            version: 1,
            slots: prev.spec.slots.map((s) =>
              s.id === id ? { ...s, locked: !(s.locked === true) } : s,
            ),
          },
        }),
        { label: "잠금 토글" },
      );
    },
    [editor],
  );

  const toggleHidden = useCallback(
    (id: string) => {
      editor.setState(
        (prev) => ({
          ...prev,
          spec: {
            version: 1,
            slots: prev.spec.slots.map((s) =>
              s.id === id ? { ...s, hidden: !(s.hidden === true) } : s,
            ),
          },
        }),
        { label: "표시 토글" },
      );
    },
    [editor],
  );

  const setLocked = useCallback(
    (value: boolean) => {
      if (selectedSlotIds.length === 0) return;
      const idSet = new Set(selectedSlotIds);
      editor.setState(
        (prev) => ({
          ...prev,
          spec: {
            version: 1,
            slots: prev.spec.slots.map((s) =>
              idSet.has(s.id) ? { ...s, locked: value } : s,
            ),
          },
        }),
        { label: value ? "잠금" : "잠금 해제" },
      );
    },
    [editor, selectedSlotIds],
  );

  const setHidden = useCallback(
    (value: boolean) => {
      if (selectedSlotIds.length === 0) return;
      const idSet = new Set(selectedSlotIds);
      editor.setState(
        (prev) => ({
          ...prev,
          spec: {
            version: 1,
            slots: prev.spec.slots.map((s) =>
              idSet.has(s.id) ? { ...s, hidden: value } : s,
            ),
          },
        }),
        { label: value ? "숨김" : "표시" },
      );
    },
    [editor, selectedSlotIds],
  );

  const groupSelected = useCallback(() => {
    if (selectedSlotIds.length < 2) return;
    const newGroupId = createGroupId();
    const idSet = new Set(selectedSlotIds);
    editor.setState(
      (prev) => ({
        ...prev,
        spec: {
          version: 1,
          slots: prev.spec.slots.map((s) =>
            idSet.has(s.id) ? { ...s, groupId: newGroupId, groupName: s.groupName ?? "그룹" } : s,
          ),
        },
      }),
      { label: "그룹 생성" },
    );
  }, [editor, selectedSlotIds]);

  const ungroupSelected = useCallback(() => {
    if (selectedSlotIds.length === 0) return;
    const sel = new Set(selectedSlotIds);
    const targetGroups = new Set<string>();
    for (const s of spec.slots) {
      if (!sel.has(s.id)) continue;
      if (s.groupId !== undefined) targetGroups.add(s.groupId);
    }
    if (targetGroups.size === 0) return;
    editor.setState(
      (prev) => ({
        ...prev,
        spec: {
          version: 1,
          slots: prev.spec.slots.map((s) => {
            if (s.groupId === undefined) return s;
            if (!targetGroups.has(s.groupId)) return s;
            const { groupId: _omit, groupName: _omit2, ...rest } = s;
            void _omit;
            void _omit2;
            return rest as TemplateSlot;
          }),
        },
      }),
      { label: "그룹 해제" },
    );
  }, [editor, selectedSlotIds, spec.slots]);

  const renameSlot = useCallback(
    (id: string, name: string) => {
      editor.setState(
        (prev) => ({
          ...prev,
          spec: {
            version: 1,
            slots: prev.spec.slots.map((s) =>
              s.id === id ? { ...s, name } : s,
            ),
          },
        }),
        { label: "이름 변경" },
      );
    },
    [editor],
  );

  const revert = useCallback(() => {
    if (!template) return;
    const coerced = coerceTemplateSpec(template.templateSpec);
    editor.reset(
      {
        name: template.name,
        isDefault: template.isDefault,
        spec: coerced,
      },
      "되돌리기",
    );
    setSelectedSlotIds((prev) => {
      const valid = prev.filter((id) => coerced.slots.some((s) => s.id === id));
      if (valid.length > 0) return valid;
      return coerced.slots.length > 0 ? [coerced.slots[0].id] : [];
    });
  }, [template, editor]);

  const save = useCallback(async () => {
    if (!template) return;
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      toast.error("템플릿 이름을 입력해주세요.");
      return;
    }
    if (trimmed.length > 100) {
      toast.error("이름은 100자 이내로 입력해주세요.");
      return;
    }
    setSaving(true);
    try {
      await updateMutation.mutateAsync({
        id: template.id,
        body: {
          name: trimmed,
          isDefault,
          templateSpec: spec,
        },
      });
      toast.success("저장했어요.");
      editor.clearFuture();
    } catch (err) {
      toast.error(
        extractApiErrorMessage(err, "저장에 실패했어요. 잠시 후 다시 시도해 주세요."),
      );
    } finally {
      setSaving(false);
    }
  }, [template, name, isDefault, spec, updateMutation, editor]);

  // 에디터 마운트 동안 html 에 클래스를 부착해 페이지 footer 숨김 + body 스크롤 고정.
  // 에디터 unmount / 페이지 이탈 시 자동 복구.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.classList.add("photoshop-editor-active");
    return () => {
      root.classList.remove("photoshop-editor-active");
    };
  }, []);

  // Cmd/Ctrl + Z / Shift+Z (undo/redo) 글로벌 단축키
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
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "z") {
        if (isFormControl(document.activeElement)) return;
        e.preventDefault();
        if (e.shiftKey) editor.redo();
        else editor.undo();
      } else if (key === "y" && !e.shiftKey) {
        if (isFormControl(document.activeElement)) return;
        e.preventDefault();
        editor.redo();
      } else if (key === "s" && !e.shiftKey) {
        e.preventDefault();
        save();
      } else if (key === "d" && !e.shiftKey) {
        if (isFormControl(document.activeElement)) return;
        e.preventDefault();
        duplicateSelected();
      } else if (key === "g") {
        if (isFormControl(document.activeElement)) return;
        e.preventDefault();
        if (e.shiftKey) ungroupSelected();
        else groupSelected();
      } else if (key === "]") {
        if (isFormControl(document.activeElement)) return;
        e.preventDefault();
        const single = selectedSlotIds[0];
        if (single) {
          if (e.shiftKey) bringToFront(single);
          else bringForward(single);
        }
      } else if (key === "[") {
        if (isFormControl(document.activeElement)) return;
        e.preventDefault();
        const single = selectedSlotIds[0];
        if (single) {
          if (e.shiftKey) sendToBack(single);
          else sendBackward(single);
        }
      } else if (key === "a" && !e.shiftKey) {
        if (isFormControl(document.activeElement)) return;
        e.preventDefault();
        selectAll();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, save, duplicateSelected, groupSelected, ungroupSelected, bringForward, bringToFront, sendBackward, sendToBack, selectAll, selectedSlotIds]);

  // Delete / Backspace
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (isFormControl(document.activeElement)) return;
      if (selectedSlotIds.length === 0) return;
      e.preventDefault();
      deleteSelected();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteSelected, selectedSlotIds.length]);

  if (isError || (!isLoading && !template)) {
    return (
      <EditorError
        listHref={listHref}
        message={extractApiErrorMessage(error, "템플릿 정보를 불러오지 못했어요.")}
        onRetry={() => refetch()}
        retrying={isFetching}
      />
    );
  }
  if (isLoading || !initialized || !template) {
    return <EditorLoading listHref={listHref} />;
  }

  return (
    <ProvideEditorAndShell
      template={template}
      listHref={listHref}
      name={name}
      isDefault={isDefault}
      spec={spec}
      dirty={dirty}
      saving={saving}
      selectedSlotIds={selectedSlotIds}
      singleSelectedSlot={singleSelectedSlot}
      activeTool={activeTool}
      setActiveTool={setActiveTool}
      canUndo={editor.canUndo}
      canRedo={editor.canRedo}
      undo={editor.undo}
      redo={editor.redo}
      historyEntries={editor.entries}
      historyCurrentIndex={editor.currentIndex}
      jumpToHistory={editor.jumpTo}
      gridSnapEnabled={gridSnapEnabled}
      setGridSnapEnabled={setGridSnapEnabled}
      foregroundColor={foregroundColor}
      setForegroundColor={setForegroundColor}
      cursorPos={cursorPos}
      setCursorPos={setCursorPos}
      zoomPercent={zoomPercent}
      setZoomPercent={setZoomPercent}
      setName={setName}
      setIsDefault={setIsDefault}
      save={save}
      revert={revert}
      selectSlot={selectSlot}
      selectMany={selectMany}
      deselectAll={deselectAll}
      selectAll={selectAll}
      cycleNextSlot={cycleNextSlot}
      cyclePrevSlot={cyclePrevSlot}
      patchSlot={patchSlot}
      moveSlots={moveSlots}
      addText={addText}
      addImage={addImage}
      addRectangle={addRectangle}
      deleteSelected={deleteSelected}
      duplicateSelected={duplicateSelected}
      alignSelected={alignSelected}
      distributeSelected={distributeSelected}
      reorderSlots={reorderSlots}
      bringForward={bringForward}
      sendBackward={sendBackward}
      bringToFront={bringToFront}
      sendToBack={sendToBack}
      toggleLocked={toggleLocked}
      toggleHidden={toggleHidden}
      setLocked={setLocked}
      setHidden={setHidden}
      groupSelected={groupSelected}
      ungroupSelected={ungroupSelected}
      renameSlot={renameSlot}
    />
  );
}

interface ProvideEditorAndShellProps
  extends Omit<EditorContextValue, "template"> {
  template: ScheduleTemplate;
}

function ProvideEditorAndShell(props: ProvideEditorAndShellProps) {
  const value: EditorContextValue = props as unknown as EditorContextValue;
  return (
    <EditorProvider value={value}>
      <EditorShell />
    </EditorProvider>
  );
}
