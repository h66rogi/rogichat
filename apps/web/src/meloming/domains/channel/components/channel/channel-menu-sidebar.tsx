"use client";

import { useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
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
import { CSS as DndCss } from "@dnd-kit/utilities";
import {
  CalendarDays,
  Check,
  GripVertical,
  Home,
  Info,
  ListMusic,
  Loader2,
  Megaphone,
  MessageSquareText,
  Music,
  Pencil,
  Shirt,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
} from "@/meloming/shared/components/ui/sidebar";
import { Button } from "@/meloming/shared/components/ui/button";
import { Input } from "@/meloming/shared/components/ui/input";
import { Switch } from "@/meloming/shared/components/ui/switch";
import {
  useChannel,
  useChannelFeatureSettings,
  useChannelPermission,
  useUpdateChannelFeatureSettings,
} from "@/meloming/domains/channel/hooks/use-channel";
import { getChannelSetlistAvailability } from "@/meloming/domains/song-live/apis/setlist";
import {
  getAllConfiguredChannelMenuItems,
  getPathFromTab,
  getTabFromPath,
  type ChannelFeatureSetting,
  type ChannelTab,
} from "@/meloming/domains/channel/types/channel-tab";
import {
  CHANNEL_FEATURE_LABEL_MAX_LENGTH,
  getEditableChannelFeatureItems,
} from "@/meloming/domains/channel/utils/channel-feature-settings";
import type { ChannelShellInitialData } from "@/meloming/features/home-new/layout/channel-shell-initial-data";
import type { PublicSetlistAvailabilityResponse } from "@/meloming/domains/song-live/types/setlist";
import UserHeader from "./user-header";
import { cn } from "@/meloming/shared/lib/utils";
import { toast } from "sonner";

/** 채널 사이드바와 페이지 상단에서 공유하는 허용 메뉴 아이콘 */
export const TAB_ICONS: Record<ChannelTab, LucideIcon> = {
  home: Home,
  musicbook: Music,
  schedule: CalendarDays,
  content: Megaphone,
  setlist: ListMusic,
  guestbook: MessageSquareText,
  info: Info,
  wardrobe: Shirt,
};

type ChannelMenuEditorItem = {
  editorId: `feature:${ChannelTab}`;
  item: ChannelFeatureSetting;
};

interface ChannelMenuSidebarProps {
  user: string;
  initialData?: ChannelShellInitialData;
}

function getEditableChannelMenuEditorItems(
  settings: Parameters<typeof getEditableChannelFeatureItems>[0]
): ChannelMenuEditorItem[] {
  return getEditableChannelFeatureItems(settings, {
    preserveOrder: true,
  }).map((item) => ({
    editorId: `feature:${item.key}`,
    item,
  }));
}

function normalizeChannelMenuEditorItems(
  items: ChannelMenuEditorItem[]
): ChannelMenuEditorItem[] {
  return items.map((entry, index) => ({
    ...entry,
    item: {
      ...entry.item,
      order: index,
    },
  }));
}

function serializeChannelMenuEditorItems(
  items: ChannelMenuEditorItem[]
): string {
  return JSON.stringify(
    normalizeChannelMenuEditorItems(items).map(({ item }) => {
      const { key, label, isEnabled, order } = item;
      return { key, label, isEnabled, order };
    })
  );
}

function toChannelMenuEditorSettingsUpdate(items: ChannelMenuEditorItem[]) {
  return {
    items: normalizeChannelMenuEditorItems(items).map(({ item }) => ({
      key: item.key,
      label: item.label,
      isEnabled: item.isEnabled,
      order: item.order,
    })),
  };
}

/**
 * 채널 화면에 허용된 8개 메뉴만 표시하고 편집한다.
 * 서버가 반환하는 제거 메뉴와 커스텀 메뉴는 이 경계에서 사용하지 않는다.
 */
export function ChannelMenuSidebar({
  user,
  initialData,
}: ChannelMenuSidebarProps) {
  const pathname = usePathname() ?? "";
  const { data: channel } = useChannel(user, {
    initialData: initialData?.channel,
  });
  const { data: permission } = useChannelPermission(user, {
    initialData: initialData?.permission,
  });
  const { data: featureSettings } = useChannelFeatureSettings(user, {
    initialData: initialData?.featureSettings,
  });
  const updateFeatureSettings = useUpdateChannelFeatureSettings(user);
  const [isEditingMenu, setIsEditingMenu] = useState(false);
  const [editorItems, setEditorItems] = useState<ChannelMenuEditorItem[]>(() =>
    getEditableChannelMenuEditorItems(undefined)
  );
  const [editorBaseline, setEditorBaseline] = useState(() =>
    serializeChannelMenuEditorItems(getEditableChannelMenuEditorItems(undefined))
  );
  const { data: setlistAvailability } =
    useQuery<PublicSetlistAvailabilityResponse>({
      queryKey: ["setlist-availability", user],
      queryFn: () => getChannelSetlistAvailability(user),
      enabled: !!user,
      initialData: initialData?.setlistAvailability,
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
    });

  const webPath = channel?.webPath || user;
  const setlistEnabled = setlistAvailability?.available ?? false;
  const currentTab = getTabFromPath(pathname);
  const pathParts = pathname.split("/").filter(Boolean);
  const isChannelHomePath =
    pathParts[0] === "channel" && pathParts.length === 2;
  const canManageMenu = !!(permission?.isOwner || permission?.manageSettings);
  const editableItems = useMemo(
    () => getEditableChannelMenuEditorItems(featureSettings),
    [featureSettings]
  );
  const isEditorDirty =
    isEditingMenu &&
    serializeChannelMenuEditorItems(editorItems) !== editorBaseline;

  const visibleTabs = getAllConfiguredChannelMenuItems(featureSettings).filter(
    (item) => {
      if (item.tabName === "setlist" && !setlistEnabled) return false;
      if (item.tabName === "content" && !channel?.isVerified) return false;
      return true;
    }
  );

  const enterMenuEditMode = () => {
    const nextItems = getEditableChannelMenuEditorItems(featureSettings);
    setEditorItems(nextItems);
    setEditorBaseline(serializeChannelMenuEditorItems(nextItems));
    setIsEditingMenu(true);
  };

  const cancelMenuEditMode = () => {
    setEditorItems(editableItems);
    setEditorBaseline(serializeChannelMenuEditorItems(editableItems));
    setIsEditingMenu(false);
  };

  const updateEditorItem = (
    editorId: ChannelMenuEditorItem["editorId"],
    patch: Partial<ChannelFeatureSetting>
  ) => {
    setEditorItems((current) =>
      current.map((entry) =>
        entry.editorId === editorId
          ? {
              ...entry,
              item: {
                ...entry.item,
                label: patch.label ?? entry.item.label,
                isEnabled: patch.isEnabled ?? entry.item.isEnabled,
              },
            }
          : entry
      )
    );
  };

  const handleEditorDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setEditorItems((current) => {
      const oldIndex = current.findIndex((item) => item.editorId === active.id);
      const newIndex = current.findIndex((item) => item.editorId === over.id);
      if (oldIndex < 0 || newIndex < 0) return current;
      return normalizeChannelMenuEditorItems(
        arrayMove(current, oldIndex, newIndex)
      );
    });
  };

  const saveMenuSettings = () => {
    updateFeatureSettings.mutate(
      toChannelMenuEditorSettingsUpdate(editorItems),
      {
        onSuccess: (result) => {
          const savedItems = getEditableChannelMenuEditorItems(result);
          setEditorItems(savedItems);
          setEditorBaseline(serializeChannelMenuEditorItems(savedItems));
          setIsEditingMenu(false);
          toast.success("채널 메뉴 설정을 저장했습니다.");
        },
        onError: () => {
          toast.error("채널 메뉴 설정 저장에 실패했습니다.");
        },
      }
    );
  };

  return (
    <Sidebar
      variant="sidebar"
      collapsible="offcanvas"
      style={{ "--sidebar": "var(--background)" } as CSSProperties}
      className="md:left-[var(--card-gap)]! md:top-[var(--site-sticky-top)]! md:bottom-[var(--card-gap)]! md:h-auto! md:rounded-l-xl! md:overflow-hidden!"
    >
      <SidebarHeader className="p-3">
        <UserHeader
          userId={user}
          userData={channel}
          userPermission={permission}
          variant="sidebar"
        />
      </SidebarHeader>

      <SidebarContent className="px-3 pt-2">
        {isEditingMenu ? (
          <ChannelMenuInlineEditor
            items={editorItems}
            onUpdate={updateEditorItem}
            onDragEnd={handleEditorDragEnd}
          />
        ) : (
          <SidebarMenu className="gap-1">
            {visibleTabs.map((item) => (
              <ChannelSidebarMenuLink
                key={item.tabName}
                href={getPathFromTab(webPath, item.tabName)}
                label={item.title}
                icon={TAB_ICONS[item.tabName]}
                isActive={
                  item.tabName === "home"
                    ? isChannelHomePath
                    : currentTab === item.tabName
                }
                isNew={item.isNew}
              />
            ))}
          </SidebarMenu>
        )}
      </SidebarContent>

      {canManageMenu ? (
        <SidebarFooter className="border-t p-3">
          {isEditingMenu ? (
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={cancelMenuEditMode}
                disabled={updateFeatureSettings.isPending}
              >
                <X className="size-4" />
                취소
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={saveMenuSettings}
                disabled={!isEditorDirty || updateFeatureSettings.isPending}
              >
                {updateFeatureSettings.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
                저장
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full justify-start"
              onClick={enterMenuEditMode}
              disabled={updateFeatureSettings.isPending}
            >
              <Pencil className="size-4" />
              채널 메뉴 편집
            </Button>
          )}
        </SidebarFooter>
      ) : null}
    </Sidebar>
  );
}

function ChannelSidebarMenuLink({
  href,
  label,
  icon: Icon,
  isActive,
  isNew,
}: {
  href: string;
  label: string;
  icon?: LucideIcon;
  isActive?: boolean;
  isNew?: boolean;
}) {
  return (
    <SidebarMenuItem>
      <Link
        href={href}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "flex items-center gap-4 rounded-full px-3 py-2 text-[17px] font-pretendard transition",
          isActive
            ? "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 font-bold hover:bg-indigo-500/15"
            : "hover:bg-accent"
        )}
      >
        {Icon ? <Icon className="size-[26px] shrink-0" /> : null}
        <span className="flex flex-1 items-center gap-1.5 min-w-0">
          <span className="truncate">{label}</span>
          {isNew ? (
            <span
              className="bg-orange-400 text-white font-bold rounded-full size-4 flex items-center justify-center shrink-0"
              style={{ fontSize: "9px" }}
            >
              N
            </span>
          ) : null}
        </span>
      </Link>
    </SidebarMenuItem>
  );
}

interface ChannelMenuInlineEditorProps {
  items: ChannelMenuEditorItem[];
  onUpdate: (
    editorId: ChannelMenuEditorItem["editorId"],
    patch: Partial<ChannelFeatureSetting>
  ) => void;
  onDragEnd: (event: DragEndEvent) => void;
}

function ChannelMenuInlineEditor({
  items,
  onUpdate,
  onDragEnd,
}: ChannelMenuInlineEditorProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext
        items={items.map((item) => item.editorId)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-1 pb-2">
          {items.map((item) => (
            <SortableChannelMenuEditorItem
              key={item.editorId}
              item={item}
              onUpdate={onUpdate}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

interface SortableChannelMenuEditorItemProps {
  item: ChannelMenuEditorItem;
  onUpdate: (
    editorId: ChannelMenuEditorItem["editorId"],
    patch: Partial<ChannelFeatureSetting>
  ) => void;
}

function SortableChannelMenuEditorItem({
  item,
  onUpdate,
}: SortableChannelMenuEditorItemProps) {
  const menuItem = item.item;
  const Icon = TAB_ICONS[menuItem.key];
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.editorId });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: DndCss.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "grid grid-cols-[auto_1fr_auto] items-center gap-1.5 rounded-lg border bg-background/70 p-1.5 shadow-xs",
        !menuItem.isEnabled && "opacity-60",
        isDragging && "relative z-10 opacity-90 shadow-md"
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 cursor-grab text-muted-foreground active:cursor-grabbing"
        aria-label={`${menuItem.defaultLabel} 순서 변경`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </Button>

      <div className="min-w-0 space-y-1">
        <div className="flex min-w-0 items-center gap-1.5 px-1">
          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-[11px] font-medium text-muted-foreground">
            {menuItem.defaultLabel}
          </span>
        </div>
        <Input
          value={menuItem.label}
          maxLength={CHANNEL_FEATURE_LABEL_MAX_LENGTH}
          onChange={(event) =>
            onUpdate(item.editorId, { label: event.currentTarget.value })
          }
          className="h-8 bg-background px-2 text-sm"
          aria-label={`${menuItem.defaultLabel} 표시 이름`}
        />
      </div>

      <Switch
        checked={menuItem.isEnabled}
        onCheckedChange={(checked) =>
          onUpdate(item.editorId, { isEnabled: checked })
        }
        aria-label={`${menuItem.defaultLabel} 노출 여부`}
      />
    </div>
  );
}
