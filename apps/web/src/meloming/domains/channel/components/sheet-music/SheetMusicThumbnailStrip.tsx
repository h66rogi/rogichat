'use client';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FileText, Music, X } from 'lucide-react';
import { cn } from '@/meloming/shared/lib/utils';
import type { SheetMusicSlot } from '@/meloming/domains/channel/types/song';

/**
 * Phase 2 Step 3 — 다중 슬롯 썸네일 strip.
 *  - 가로 스크롤 strip (compact 모드 외부에서만 노출).
 *  - 클릭 → currentIndex 이동
 *  - drag-reorder (dnd-kit) → onReorder(orderedIds) 호출
 *  - 각 썸네일에 X 버튼 → onDeleteSlot(slotId) 호출
 *  - 이미지: <img> 미리보기 (referrerPolicy=no-referrer)
 *  - PDF: FileText 아이콘 + "PDF" 라벨 (다중 페이지 첫 페이지 썸네일은 비용 큼,
 *    Phase 2 step 4 검토)
 *  - MusicXML: Music 아이콘 + "MXL" 라벨
 */
export interface SheetMusicThumbnailStripProps {
  slots: SheetMusicSlot[];
  currentIndex: number;
  onSelect: (index: number) => void;
  onReorder: (orderedIds: number[]) => void;
  onDeleteSlot?: (slotId: number) => void;
  /** readOnly = drag/delete 비활성, 클릭 nav 만 허용. */
  readOnly?: boolean;
}

export function SheetMusicThumbnailStrip({
  slots,
  currentIndex,
  onSelect,
  onReorder,
  onDeleteSlot,
  readOnly = false,
}: SheetMusicThumbnailStripProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      // 드래그 거리 5px 이상이면 sortable 시작 — 짧은 클릭은 onSelect 로
      activationConstraint: { distance: 5 },
    }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = slots.findIndex((s) => s.id === active.id);
    const newIndex = slots.findIndex((s) => s.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const newOrder = arrayMove(slots, oldIndex, newIndex);
    onReorder(newOrder.map((s) => s.id));
  }

  if (slots.length === 0) return null;

  return (
    <div className="px-2 py-2 border-t bg-muted/30">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={slots.map((s) => s.id)}
          strategy={horizontalListSortingStrategy}
          disabled={readOnly}
        >
          <div className="flex gap-2 overflow-x-auto">
            {slots.map((slot, idx) => (
              <ThumbnailItem
                key={slot.id}
                slot={slot}
                isActive={idx === currentIndex}
                onSelect={() => onSelect(idx)}
                onDelete={
                  !readOnly && onDeleteSlot
                    ? () => onDeleteSlot(slot.id)
                    : undefined
                }
                readOnly={readOnly}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

interface ThumbnailItemProps {
  slot: SheetMusicSlot;
  isActive: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  readOnly: boolean;
}

function ThumbnailItem({
  slot,
  isActive,
  onSelect,
  onDelete,
  readOnly,
}: ThumbnailItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: slot.id, disabled: readOnly });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className={cn(
        'relative shrink-0 group cursor-pointer rounded border-2 motion-safe:transition-colors',
        isActive
          ? 'border-primary'
          : 'border-transparent hover:border-border',
      )}
      {...attributes}
      {...(readOnly ? {} : listeners)}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      aria-label={`슬롯 ${slot.sortOrder + 1}${isActive ? ' (현재)' : ''}`}
      aria-pressed={isActive}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="size-16 bg-background rounded-sm overflow-hidden flex items-center justify-center">
        {slot.type === 'IMAGE' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={slot.url}
            alt=""
            referrerPolicy="no-referrer"
            className="size-full object-cover"
            draggable={false}
          />
        ) : slot.type === 'PDF' ? (
          <div className="flex flex-col items-center gap-0.5 text-muted-foreground">
            <FileText className="size-6" />
            <span className="text-[9px] font-mono">PDF</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-0.5 text-muted-foreground">
            <Music className="size-6" />
            <span className="text-[9px] font-mono">MXL</span>
          </div>
        )}
      </div>
      {onDelete && (
        <button
          type="button"
          className="absolute -top-1 -right-1 size-5 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 motion-safe:transition-opacity flex items-center justify-center"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label={`슬롯 ${slot.sortOrder + 1} 삭제`}
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}
