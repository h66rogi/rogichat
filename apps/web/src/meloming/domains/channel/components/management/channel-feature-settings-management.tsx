"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  ListChecks,
  Loader2,
  RotateCcw,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import { ManagementHeader } from "./management-header";
import { Button } from "@/meloming/shared/components/ui/button";
import { Input } from "@/meloming/shared/components/ui/input";
import { Label } from "@/meloming/shared/components/ui/label";
import { Switch } from "@/meloming/shared/components/ui/switch";
import {
  DEFAULT_CHANNEL_FEATURE_SETTINGS,
  TAB_CONFIG,
  type ChannelFeatureSetting,
} from "@/meloming/domains/channel/types/channel-tab";
import {
  useChannelFeatureSettings,
  useUpdateChannelFeatureSettings,
} from "@/meloming/domains/channel/hooks/use-channel";
import {
  CHANNEL_FEATURE_LABEL_MAX_LENGTH,
  getEditableChannelFeatureItems,
  normalizeChannelFeatureItems,
  serializeChannelFeatureItems,
  toChannelFeatureSettingsUpdate,
} from "@/meloming/domains/channel/utils/channel-feature-settings";
import { cn } from "@/meloming/shared/lib/utils";
import {
  SettingsCompactProvider,
  SettingsPanel,
  SettingsRow,
  SettingsSectionHeader,
} from "@/meloming/shared/components/common/settings-form";

export function ChannelFeatureSettingsManagement() {
  const params = useParams();
  const identifier = (params?.user as string) || "";
  const { data, isLoading } = useChannelFeatureSettings(identifier);

  if (isLoading) {
    return (
      <div className="p-6">
        <ManagementHeader
          title="채널 기능"
          description="채널에 노출되는 메뉴를 관리합니다."
          icon={ListChecks}
        />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <ChannelFeatureSettingsEditor
      identifier={identifier}
      initialItems={getEditableChannelFeatureItems(data)}
    />
  );
}

function ChannelFeatureSettingsEditor({
  identifier,
  initialItems,
}: {
  identifier: string;
  initialItems: ChannelFeatureSetting[];
}) {
  const updateMutation = useUpdateChannelFeatureSettings(identifier);
  const [items, setItems] = useState<ChannelFeatureSetting[]>(() =>
    normalizeChannelFeatureItems(initialItems, { sortByOrder: true })
  );
  const [baseline, setBaseline] = useState(() =>
    serializeChannelFeatureItems(
      normalizeChannelFeatureItems(initialItems, { sortByOrder: true })
    )
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  const isDirty =
    items.length > 0 && serializeChannelFeatureItems(items) !== baseline;

  const save = () => {
    const normalized = normalizeChannelFeatureItems(items);
    updateMutation.mutate(toChannelFeatureSettingsUpdate(normalized), {
      onSuccess: (result) => {
        const savedItems = normalizeChannelFeatureItems(
          getEditableChannelFeatureItems(result),
          { sortByOrder: true }
        );
        setItems(savedItems);
        setBaseline(serializeChannelFeatureItems(savedItems));
        toast.success("채널 메뉴 설정을 저장했습니다.");
      },
      onError: () => {
        toast.error("채널 메뉴 설정 저장에 실패했습니다.");
      },
    });
  };

  const resetToDefault = () => {
    setItems(
      normalizeChannelFeatureItems(DEFAULT_CHANNEL_FEATURE_SETTINGS.items)
    );
  };

  const updateItem = (
    key: ChannelFeatureSetting["key"],
    patch: Partial<ChannelFeatureSetting>
  ) => {
    setItems((current) =>
      current.map((item) =>
        item.key === key ? { ...item, ...patch } : item
      )
    );
  };

  const moveItem = (key: ChannelFeatureSetting["key"], direction: -1 | 1) => {
    setItems((current) => {
      const index = current.findIndex((item) => item.key === key);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }
      return normalizeChannelFeatureItems(
        arrayMove(current, index, nextIndex)
      );
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setItems((current) => {
      const oldIndex = current.findIndex((item) => item.key === active.id);
      const newIndex = current.findIndex((item) => item.key === over.id);
      if (oldIndex < 0 || newIndex < 0) return current;
      return normalizeChannelFeatureItems(
        arrayMove(current, oldIndex, newIndex)
      );
    });
  };

  return (
    <div className="p-6">
      <ManagementHeader
        title="채널 기능"
        description="채널에 노출되는 8개 메뉴의 이름과 순서를 관리합니다."
        icon={ListChecks}
      />

      <SettingsPanel>
        <SettingsSectionHeader title="채널 메뉴" />
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={items.map((item) => item.key)}
            strategy={verticalListSortingStrategy}
          >
            <div className="divide-y">
              {items.map((item, index) => (
                <SortableFeatureItem
                  key={item.key}
                  item={item}
                  index={index}
                  total={items.length}
                  onUpdate={updateItem}
                  onMove={moveItem}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        <div className="flex flex-col gap-2 border-t py-4 sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={resetToDefault}
            disabled={updateMutation.isPending}
          >
            <RotateCcw className="size-4" />
            기본값
          </Button>
          <Button
            type="button"
            onClick={save}
            disabled={!isDirty || updateMutation.isPending}
          >
            {updateMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            저장
          </Button>
        </div>
      </SettingsPanel>
    </div>
  );
}

interface SortableFeatureItemProps {
  item: ChannelFeatureSetting;
  index: number;
  total: number;
  onUpdate: (
    key: ChannelFeatureSetting["key"],
    patch: Partial<ChannelFeatureSetting>
  ) => void;
  onMove: (key: ChannelFeatureSetting["key"], direction: -1 | 1) => void;
}

function SortableFeatureItem({
  item,
  index,
  total,
  onUpdate,
  onMove,
}: SortableFeatureItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.key });
  const path = TAB_CONFIG[item.key].path;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn("bg-card", isDragging && "relative z-10 opacity-80")}
    >
      <SettingsCompactProvider compact>
        <SettingsRow
          title={item.defaultLabel}
          description={path ? `/${path}` : "/"}
          className="min-h-[76px]"
        >
          <div className="grid gap-2 sm:grid-cols-[auto_1fr_auto] sm:items-center">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="cursor-grab text-muted-foreground active:cursor-grabbing"
              aria-label={`${item.defaultLabel} 순서 변경`}
              {...attributes}
              {...listeners}
            >
              <GripVertical className="size-4" />
            </Button>
            <div className="min-w-0 space-y-1">
              <Label htmlFor={`feature-label-${item.key}`} className="sr-only">
                표시 이름
              </Label>
              <Input
                id={`feature-label-${item.key}`}
                value={item.label}
                maxLength={CHANNEL_FEATURE_LABEL_MAX_LENGTH}
                onChange={(event) =>
                  onUpdate(item.key, { label: event.currentTarget.value })
                }
              />
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onMove(item.key, -1)}
                disabled={index === 0}
                aria-label={`${item.defaultLabel} 위로 이동`}
              >
                <ArrowUp className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onMove(item.key, 1)}
                disabled={index === total - 1}
                aria-label={`${item.defaultLabel} 아래로 이동`}
              >
                <ArrowDown className="size-4" />
              </Button>
              <Switch
                checked={item.isEnabled}
                onCheckedChange={(checked) =>
                  onUpdate(item.key, { isEnabled: checked })
                }
                aria-label={`${item.defaultLabel} 노출 여부`}
              />
            </div>
          </div>
        </SettingsRow>
      </SettingsCompactProvider>
    </div>
  );
}
