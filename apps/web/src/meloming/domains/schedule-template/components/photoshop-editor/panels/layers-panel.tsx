"use client";

import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  ImageIcon,
  Lock,
  Move,
  Plus,
  Trash2,
  Type,
  Unlock,
} from "lucide-react";
import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/meloming/shared/lib/utils";
import { Slider } from "@/meloming/shared/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/meloming/shared/components/ui/select";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/meloming/shared/components/ui/context-menu";
import { describeSlot } from "../../editor/default-slots";
import {
  BLEND_MODE_LABELS,
  type BlendMode,
  type ImageSlot,
  type TemplateSlot,
  type TextSlot,
} from "@/meloming/domains/schedule-template/types/template-spec";
import { useEditorContext } from "../state/editor-context";

/**
 * Photoshop 스타일 레이어 패널.
 *
 * 구조:
 *  - 헤더: "레이어"
 *  - 블렌드 모드 + 불투명도 (선택된 슬롯에 적용)
 *  - 잠금 variants (전체 / 위치 / 가시성)
 *  - 레이어 목록 (z-index 역순. 그룹은 폴더로 collapse 가능)
 *  - 하단 툴바: 새 그룹 / 새 텍스트 / 새 이미지 / 삭제
 *
 * 그룹 처리:
 *  - 기존 데이터 모델은 flat groupId. 같은 groupId 슬롯들을 패널에서 한 줄
 *    "[▾ 그룹명]" 으로 묶어 보여주고, expand 시 자식 슬롯이 들여쓰기 표시.
 *  - 이름은 groupName, 미지정 시 "그룹".
 *  - 저장된 데이터에는 영향 없음. 패널 UI 상태만 별도 관리.
 */
export function LayersPanel() {
  const ctx = useEditorContext();
  const { spec, selectedSlotIds } = ctx;

  // 그룹 expand/collapse 상태 (UI-only).
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // z-index 역순 + 그룹화. 그룹은 가장 아래(z-index 작은) 멤버 위치를 기준으로 정렬.
  const tree = useMemo(() => buildLayerTree(spec.slots), [spec.slots]);

  const selectedSet = useMemo(() => new Set(selectedSlotIds), [selectedSlotIds]);

  // 첫 선택 슬롯의 opacity / blendMode 를 패널 상단 슬라이더 기본값으로.
  const focused = useMemo(() => {
    if (selectedSlotIds.length === 0) return null;
    return spec.slots.find((s) => s.id === selectedSlotIds[0]) ?? null;
  }, [spec.slots, selectedSlotIds]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  // dnd-kit: 모든 leaf id (그룹은 헤더 id 로 표현, 자식은 그 자체).
  const sortableIds = useMemo(() => collectSortableIds(tree), [tree]);

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      const activeId = String(active.id);
      const overId = String(over.id);
      // group header 는 group:<id> 형식. 자식 자체의 reorder 만 일단 지원.
      if (activeId.startsWith("group:") || overId.startsWith("group:")) return;
      const fromIdx = spec.slots.findIndex((s) => s.id === activeId);
      const toIdx = spec.slots.findIndex((s) => s.id === overId);
      if (fromIdx === -1 || toIdx === -1) return;
      // panel 표시 순서는 z-index 역순. 사용자가 위로 끌면 z-index up.
      const next = arrayMove(spec.slots, fromIdx, toIdx);
      ctx.reorderSlots(next);
    },
    [ctx, spec.slots],
  );

  const handleSetOpacity = useCallback(
    (id: string, opacity: number) => {
      ctx.patchSlot(id, { opacity }, {
        coalesceKey: `opacity:${id}`,
        label: "불투명도",
      });
    },
    [ctx],
  );

  const handleSetBlendMode = useCallback(
    (id: string, blendMode: BlendMode) => {
      ctx.patchSlot(id, { blendMode }, { label: "블렌드 모드" });
    },
    [ctx],
  );

  const handleToggleGroup = (groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="ps-panel-header">레이어</div>

      {/* 블렌드 모드 + 불투명도 */}
      <div
        className="px-2 py-2 border-b shrink-0 space-y-2"
        style={{ borderColor: "var(--ps-divider)" }}
      >
        <div className="flex items-center gap-2">
          <Select
            value={focused?.blendMode ?? "normal"}
            onValueChange={(v) =>
              focused && handleSetBlendMode(focused.id, v as BlendMode)
            }
            disabled={!focused}
          >
            <SelectTrigger className="ps-select flex-1 h-6">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[var(--ps-bg-elevated)] border-[var(--ps-border)] text-[var(--ps-text)]">
              <SelectGroup>
                {(Object.keys(BLEND_MODE_LABELS) as BlendMode[]).map((m) => (
                  <SelectItem key={m} value={m}>
                    {BLEND_MODE_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="ps-label w-12">불투명도</span>
          <Slider
            value={[Math.round((focused?.opacity ?? 1) * 100)]}
            min={0}
            max={100}
            step={1}
            onValueChange={(v) =>
              focused && handleSetOpacity(focused.id, v[0] / 100)
            }
            disabled={!focused}
            className="flex-1"
          />
          <span
            className="text-[11px] tabular-nums w-9 text-right"
            style={{ color: "var(--ps-text)" }}
          >
            {Math.round((focused?.opacity ?? 1) * 100)}%
          </span>
        </div>

        {/* 잠금 토글 */}
        <div className="flex items-center gap-1 text-[11px]">
          <span className="ps-label w-12">잠금</span>
          <LockButton
            active={focused?.locked === true}
            Icon={Lock}
            label="모두 잠금"
            onClick={() =>
              focused && ctx.patchSlot(focused.id, { locked: !(focused.locked === true) }, { label: "잠금" })
            }
            disabled={!focused}
          />
          <LockButton
            active={focused?.lockPosition === true}
            Icon={Move}
            label="위치 잠금"
            onClick={() =>
              focused &&
              ctx.patchSlot(
                focused.id,
                { lockPosition: !(focused.lockPosition === true) },
                { label: "위치 잠금" },
              )
            }
            disabled={!focused || focused?.locked === true}
          />
        </div>
      </div>

      {/* 레이어 목록 */}
      <div className="ps-panel-body">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
            {tree.length === 0 ? (
              <div className="px-3 py-6 text-center text-[11px] text-[var(--ps-text-muted)]">
                레이어가 없습니다.
                <br />
                아래 + 버튼으로 추가하세요.
              </div>
            ) : (
              tree.map((node) =>
                node.kind === "group" ? (
                  <GroupNode
                    key={`group:${node.groupId}`}
                    name={node.name}
                    groupId={node.groupId}
                    children={node.children}
                    collapsed={collapsedGroups.has(node.groupId)}
                    selectedSet={selectedSet}
                    onToggleCollapse={() => handleToggleGroup(node.groupId)}
                  />
                ) : (
                  <LayerRow
                    key={node.slot.id}
                    slot={node.slot}
                    selected={selectedSet.has(node.slot.id)}
                    indent={0}
                  />
                ),
              )
            )}
          </SortableContext>
        </DndContext>
      </div>

      {/* 하단 툴바 */}
      <div
        className="flex items-center gap-1 px-2 py-1 border-t shrink-0"
        style={{
          background: "var(--ps-bg-elevated)",
          borderColor: "var(--ps-divider)",
        }}
      >
        <FooterButton
          label="새 텍스트"
          Icon={Type}
          onClick={() => ctx.addText()}
        />
        <FooterButton
          label="새 이미지"
          Icon={ImageIcon}
          onClick={() => ctx.addImage()}
        />
        <FooterButton
          label="새 그룹"
          Icon={Folder}
          onClick={() =>
            ctx.selectedSlotIds.length >= 2
              ? ctx.groupSelected()
              : undefined
          }
          disabled={ctx.selectedSlotIds.length < 2}
        />
        <span className="flex-1" />
        <FooterButton
          label="삭제"
          Icon={Trash2}
          onClick={() => ctx.deleteSelected()}
          disabled={ctx.selectedSlotIds.length === 0}
        />
      </div>
    </div>
  );
}

interface LockButtonProps {
  active: boolean;
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

function LockButton({ active, Icon, label, onClick, disabled }: LockButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className={cn("ps-tool-button", active && "is-active")}
      style={{ width: 22, height: 22 }}
    >
      <Icon className="size-3" />
    </button>
  );
}

interface FooterButtonProps {
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  disabled?: boolean;
}

function FooterButton({ label, Icon, onClick, disabled }: FooterButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="ps-tool-button"
      style={{ width: 26, height: 26 }}
    >
      <Icon className="size-3.5" />
    </button>
  );
}

// ─────────────────────────────────────────────
// 트리 빌드
// ─────────────────────────────────────────────

type LayerNode =
  | { kind: "slot"; slot: TemplateSlot }
  | { kind: "group"; groupId: string; name: string; children: TemplateSlot[] };

/**
 * slots 를 z-index 역순 + 그룹 폴더로 묶어 트리화.
 *
 * 같은 groupId 슬롯은 하나의 group 노드로 합치고, 그 안에 z-index 역순으로 children 배열 생성.
 * group 노드의 외부 위치는 그룹 첫 멤버(z-index 가장 큰 것) 의 인덱스를 기준.
 */
function buildLayerTree(slots: TemplateSlot[]): LayerNode[] {
  if (slots.length === 0) return [];

  // z-index 역순 (마지막이 가장 위).
  const reversed = [...slots].reverse();

  const result: LayerNode[] = [];
  const seenGroups = new Set<string>();

  for (const slot of reversed) {
    if (slot.groupId !== undefined) {
      if (seenGroups.has(slot.groupId)) continue;
      seenGroups.add(slot.groupId);
      const members = reversed.filter((s) => s.groupId === slot.groupId);
      result.push({
        kind: "group",
        groupId: slot.groupId,
        name: slot.groupName ?? `그룹 (${members.length})`,
        children: members,
      });
      continue;
    }
    result.push({ kind: "slot", slot });
  }

  return result;
}

function collectSortableIds(tree: LayerNode[]): string[] {
  const ids: string[] = [];
  for (const node of tree) {
    if (node.kind === "group") {
      ids.push(`group:${node.groupId}`);
      for (const c of node.children) ids.push(c.id);
    } else {
      ids.push(node.slot.id);
    }
  }
  return ids;
}

// ─────────────────────────────────────────────
// 그룹 노드
// ─────────────────────────────────────────────

interface GroupNodeProps {
  name: string;
  groupId: string;
  children: TemplateSlot[];
  collapsed: boolean;
  selectedSet: Set<string>;
  onToggleCollapse: () => void;
}

function GroupNode({
  name,
  groupId,
  children,
  collapsed,
  selectedSet,
  onToggleCollapse,
}: GroupNodeProps) {
  const ctx = useEditorContext();
  const allHidden = children.every((c) => c.hidden === true);
  const allLocked = children.every((c) => c.locked === true);

  const toggleAllHidden = () => {
    const next = !allHidden;
    for (const c of children) {
      ctx.patchSlot(c.id, { hidden: next }, { label: next ? "그룹 숨김" : "그룹 표시" });
    }
  };
  const toggleAllLocked = () => {
    const next = !allLocked;
    for (const c of children) {
      ctx.patchSlot(c.id, { locked: next }, { label: next ? "그룹 잠금" : "그룹 잠금 해제" });
    }
  };

  return (
    <>
      <div
        className="ps-row"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("[data-action]")) return;
          // 그룹 헤더 클릭 → 모든 자식 선택.
          ctx.selectMany(children.map((c) => c.id));
        }}
      >
        <button
          type="button"
          data-action="toggle-collapse"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse();
          }}
          className="size-4 flex items-center justify-center"
          aria-label={collapsed ? "펼치기" : "접기"}
        >
          {collapsed ? (
            <ChevronRight className="size-3" />
          ) : (
            <ChevronDown className="size-3" />
          )}
        </button>
        <button
          type="button"
          data-action="toggle-hidden"
          onClick={(e) => {
            e.stopPropagation();
            toggleAllHidden();
          }}
          className="size-4 flex items-center justify-center"
          aria-label={allHidden ? "표시" : "숨김"}
        >
          {allHidden ? (
            <EyeOff className="size-3" style={{ color: "var(--ps-text-muted)" }} />
          ) : (
            <Eye className="size-3" />
          )}
        </button>
        {collapsed ? (
          <Folder className="size-3.5 mx-1" style={{ color: "var(--ps-text-muted)" }} />
        ) : (
          <FolderOpen className="size-3.5 mx-1" style={{ color: "var(--ps-text-muted)" }} />
        )}
        <span className="flex-1 truncate font-medium">{name}</span>
        <span className="text-[10px]" style={{ color: "var(--ps-text-muted)" }}>
          {children.length}
        </span>
        <button
          type="button"
          data-action="toggle-locked"
          onClick={(e) => {
            e.stopPropagation();
            toggleAllLocked();
          }}
          className="size-4 flex items-center justify-center ml-1"
          aria-label={allLocked ? "잠금 해제" : "잠금"}
        >
          {allLocked ? (
            <Lock className="size-3" />
          ) : (
            <Unlock className="size-3" style={{ color: "var(--ps-text-muted)" }} />
          )}
        </button>
      </div>

      {!collapsed &&
        children.map((c) => (
          <LayerRow key={c.id} slot={c} selected={selectedSet.has(c.id)} indent={1} />
        ))}
    </>
  );
}

// ─────────────────────────────────────────────
// 레이어 행
// ─────────────────────────────────────────────

interface LayerRowProps {
  slot: TemplateSlot;
  selected: boolean;
  indent: number;
}

function LayerRow({ slot, selected, indent }: LayerRowProps) {
  const ctx = useEditorContext();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: slot.id });

  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(slot.name ?? "");

  const isHidden = slot.hidden === true;
  const isLocked = slot.locked === true;

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    paddingLeft: indent * 16,
  };

  const handleRowClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-action]")) return;
    ctx.selectSlot(slot.id, {
      shiftKey: e.shiftKey,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
    });
  };

  const commitRename = () => {
    setRenaming(false);
    if (draftName.trim() === (slot.name ?? "")) return;
    ctx.renameSlot(slot.id, draftName.trim());
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          {...attributes}
          {...listeners}
          style={style}
          className={cn(
            "ps-row",
            selected && "is-selected",
            isHidden && "opacity-60 italic",
          )}
          onClick={handleRowClick}
          onDoubleClick={() => {
            setDraftName(slot.name ?? describeSlot(slot));
            setRenaming(true);
          }}
        >
          <button
            type="button"
            data-action="toggle-hidden"
            onClick={(e) => {
              e.stopPropagation();
              ctx.toggleHidden(slot.id);
            }}
            className="size-4 flex items-center justify-center"
            aria-label={isHidden ? "표시" : "숨김"}
          >
            {isHidden ? (
              <EyeOff className="size-3" style={{ color: "var(--ps-text-muted)" }} />
            ) : (
              <Eye className="size-3" />
            )}
          </button>

          <LayerThumbnail slot={slot} />

          {renaming ? (
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setRenaming(false);
              }}
              className="ps-num-input flex-1"
              style={{ width: "auto" }}
            />
          ) : (
            <span className="flex-1 truncate text-[11px]">
              {describeSlot(slot)}
            </span>
          )}

          {isLocked && (
            <Lock
              className="size-3 ml-1"
              style={{ color: "var(--ps-text-muted)" }}
            />
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent
        className="bg-[var(--ps-bg-elevated)] border-[var(--ps-border)] text-[var(--ps-text)] min-w-[180px]"
      >
        <ContextMenuItem onSelect={() => ctx.duplicateSelected()}>
          레이어 복제
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => ctx.deleteSelected()}>
          삭제
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => {
            setDraftName(slot.name ?? describeSlot(slot));
            setRenaming(true);
          }}
        >
          이름 변경
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => ctx.bringToFront(slot.id)}>
          맨 앞으로
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => ctx.bringForward(slot.id)}>
          앞으로
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => ctx.sendBackward(slot.id)}>
          뒤로
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => ctx.sendToBack(slot.id)}>
          맨 뒤로
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => ctx.toggleLocked(slot.id)}>
          {isLocked ? "잠금 해제" : "잠그기"}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => ctx.toggleHidden(slot.id)}>
          {isHidden ? "표시" : "숨기기"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * 레이어 썸네일 (24×24 미니 미리보기).
 *
 * 텍스트 슬롯: 폰트 색상의 작은 "Aa" 표시.
 * 이미지 슬롯: 실제 이미지 또는 placeholder.
 */
function LayerThumbnail({ slot }: { slot: TemplateSlot }) {
  const size = 22;
  if (slot.type === "text") {
    const text = slot as TextSlot;
    return (
      <div
        className="rounded-sm flex items-center justify-center text-[10px] font-bold mx-1 shrink-0"
        style={{
          width: size,
          height: size,
          background: "#1a1a1a",
          color: text.font.color,
          border: "1px solid var(--ps-border)",
        }}
        aria-hidden
      >
        Aa
      </div>
    );
  }
  const image = slot as ImageSlot;
  const url = image.fallbackUrl?.trim();
  return (
    <div
      className="rounded-sm overflow-hidden mx-1 shrink-0 flex items-center justify-center"
      style={{
        width: size,
        height: size,
        background: "var(--ps-bg-input)",
        border: "1px solid var(--ps-border)",
      }}
      aria-hidden
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          className="w-full h-full object-cover"
          draggable={false}
        />
      ) : (
        <ImageIcon className="size-3" style={{ color: "var(--ps-text-muted)" }} />
      )}
    </div>
  );
}

interface FooterPlusProps {
  // 사용 안 함 — 자리 차지용 placeholder
}
function _FooterPlus(_p: FooterPlusProps) {
  return <Plus className="size-3.5" />;
}
