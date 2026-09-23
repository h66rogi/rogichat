"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { useParams } from "next/navigation";
import {
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  ImagePlus,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  Shirt,
  SlidersHorizontal,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ManagementHeader } from "./management-header";
import { Badge } from "@/meloming/shared/components/ui/badge";
import { Button } from "@/meloming/shared/components/ui/button";
import { Input } from "@/meloming/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/meloming/shared/components/ui/select";
import { Skeleton } from "@/meloming/shared/components/ui/skeleton";
import { Switch } from "@/meloming/shared/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/meloming/shared/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/meloming/shared/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/meloming/shared/components/ui/dropdown-menu";
import { cn } from "@/meloming/shared/lib/utils";
import EditorTiptap from "@/meloming/shared/components/editor/editor-tiptap";
import { useImageUpload } from "@/meloming/shared/hooks/use-image-upload";
import { extractApiErrorMessage } from "@/meloming/shared/lib/api-error";
import {
  useChannelWardrobeManage,
  useCreateWardrobeCategory,
  useCreateWardrobeItem,
  useDeleteWardrobeCategory,
  useDeleteWardrobeItem,
  useUpdateWardrobeCategory,
  useUpdateWardrobeItem,
} from "@/meloming/domains/channel/hooks/use-wardrobe";
import {
  DEFAULT_WARDROBE_ASPECT_RATIO,
  WARDROBE_TAG_MAX_COUNT,
  WARDROBE_TAG_MAX_LENGTH,
  WARDROBE_ASPECT_RATIOS,
  type ChannelWardrobeCategory,
  type ChannelWardrobeItem,
  type WardrobeAspectRatio,
} from "@/meloming/domains/channel/types/wardrobe";
import {
  getWardrobeAspectRatioStyle,
  normalizeWardrobeAspectRatio,
  WARDROBE_ASPECT_RATIO_META,
} from "@/meloming/domains/channel/utils/wardrobe-aspect-ratio";
import { extractWardrobeDescriptionText } from "@/meloming/domains/channel/utils/wardrobe-description";
import {
  SettingsCompactProvider,
  SettingsRow,
} from "@/meloming/shared/components/common/settings-form";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const HEADER_DESCRIPTION = "의상, 헤어 등 채널 이미지 항목을 관리합니다.";

function validateImageFile(file: File): boolean {
  if (!file.type.startsWith("image/")) {
    toast.error("이미지 파일만 업로드할 수 있습니다.");
    return false;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    toast.error("파일 크기는 10MB 이하여야 합니다.");
    return false;
  }
  return true;
}

export function WardrobeManagement() {
  const params = useParams();
  const identifier = (params?.user as string) || "";
  const { data, isLoading, error } = useChannelWardrobeManage(identifier);

  const [activeCategoryId, setActiveCategoryId] = useState<number | null>(null);
  const [itemDialog, setItemDialog] = useState<{
    mode: "create" | "edit";
    item: ChannelWardrobeItem | null;
  }>({ mode: "create", item: null });
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);

  const categories = useMemo(() => data?.categories ?? [], [data?.categories]);
  const items = useMemo(() => data?.items ?? [], [data?.items]);

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.order - b.order),
    [categories],
  );

  const countByCategory = useMemo(() => {
    const map = new Map<number, number>();
    for (const item of items) {
      map.set(item.categoryId, (map.get(item.categoryId) ?? 0) + 1);
    }
    return map;
  }, [items]);

  const visibleItems = useMemo(() => {
    const base =
      activeCategoryId == null
        ? items
        : items.filter((item) => item.categoryId === activeCategoryId);
    return [...base].sort((a, b) => a.order - b.order);
  }, [activeCategoryId, items]);
  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );
  const activeCategoryAspectRatio = activeCategoryId
    ? categoryById.get(activeCategoryId)?.defaultAspectRatio
    : DEFAULT_WARDROBE_ASPECT_RATIO;

  const openCreate = () => {
    setItemDialog({ mode: "create", item: null });
    setItemDialogOpen(true);
  };

  const openEdit = (item: ChannelWardrobeItem) => {
    setItemDialog({ mode: "edit", item });
    setItemDialogOpen(true);
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <ManagementHeader
          title="옷장"
          description={HEADER_DESCRIPTION}
          icon={Shirt}
        />
        <div className="mb-5 flex flex-wrap gap-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-8 w-20 rounded-full" />
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="aspect-[4/3] rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <ManagementHeader
          title="옷장"
          description={HEADER_DESCRIPTION}
          icon={Shirt}
        />
        <div className="rounded-xl border bg-card py-12 text-center text-sm text-muted-foreground">
          옷장 정보를 불러오지 못했습니다.
        </div>
      </div>
    );
  }

  const hasCategories = categories.length > 0;

  return (
    <div className="p-6">
      <ManagementHeader
        title="옷장"
        description={HEADER_DESCRIPTION}
        icon={Shirt}
      >
        <Badge variant="outline" className="text-[10px] font-bold">
          NEW
        </Badge>
        {hasCategories && (
          <Button type="button" size="sm" onClick={openCreate}>
            <Plus className="size-4" />
            항목 추가
          </Button>
        )}
      </ManagementHeader>

      {!hasCategories ? (
        <div className="rounded-xl border border-dashed bg-muted/20 px-6 py-16 text-center">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10">
            <Shirt className="size-7 text-primary" />
          </div>
          <h3 className="paperlogy text-base font-semibold">
            옷장을 시작해보세요
          </h3>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
            의상·헤어 분류를 먼저 만들면 시청자에게 보여줄 이미지를 추가할 수
            있어요.
          </p>
          <Button className="mt-5" onClick={() => setCategoryDialogOpen(true)}>
            <Plus className="size-4" />
            분류 만들기
          </Button>
        </div>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <CategoryChip
              active={activeCategoryId == null}
              label="전체"
              count={items.length}
              onClick={() => setActiveCategoryId(null)}
            />
            {sortedCategories.map((category) => (
              <CategoryChip
                key={category.id}
                active={activeCategoryId === category.id}
                label={category.name}
                count={countByCategory.get(category.id) ?? 0}
                dimmed={!category.isEnabled}
                onClick={() => setActiveCategoryId(category.id)}
              />
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto gap-1.5 text-muted-foreground"
              onClick={() => setCategoryDialogOpen(true)}
            >
              <SlidersHorizontal className="size-4" />
              분류 관리
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <AddItemTile
              aspectRatio={activeCategoryAspectRatio}
              onClick={openCreate}
            />
            {visibleItems.map((item) => (
              <WardrobeItemCard
                key={item.id}
                item={item}
                category={categoryById.get(item.categoryId)}
                identifier={identifier}
                onEdit={() => openEdit(item)}
              />
            ))}
          </div>

          {visibleItems.length === 0 && (
            <p className="mt-8 text-center text-sm text-muted-foreground">
              {activeCategoryId == null
                ? "아직 등록된 옷장 항목이 없어요. 위 카드를 눌러 첫 항목을 추가해보세요."
                : "이 분류에는 아직 항목이 없어요."}
            </p>
          )}
        </>
      )}

      <WardrobeItemDialog
        open={itemDialogOpen}
        onOpenChange={setItemDialogOpen}
        mode={itemDialog.mode}
        item={itemDialog.item}
        categories={sortedCategories}
        identifier={identifier}
        defaultCategoryId={activeCategoryId ?? undefined}
      />
      <CategoryManagerDialog
        open={categoryDialogOpen}
        onOpenChange={setCategoryDialogOpen}
        identifier={identifier}
        categories={sortedCategories}
      />
    </div>
  );
}

function CategoryChip({
  active,
  label,
  count,
  dimmed,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  dimmed?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "secondary"}
      onClick={onClick}
      className={cn("gap-1.5 rounded-full", dimmed && !active && "opacity-55")}
    >
      {dimmed && <EyeOff className="size-3" />}
      <span className="max-w-[10rem] truncate">{label}</span>
      <span
        className={cn(
          "rounded-full px-1.5 text-[10px] tabular-nums",
          active ? "bg-primary-foreground/20" : "bg-foreground/10",
        )}
      >
        {count}
      </span>
    </Button>
  );
}

function AddItemTile({
  aspectRatio,
  onClick,
}: {
  aspectRatio?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-[10rem] w-full flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed text-muted-foreground transition hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
      style={getWardrobeAspectRatioStyle(aspectRatio)}
    >
      <div className="flex size-11 items-center justify-center rounded-full bg-muted transition group-hover:bg-primary/10">
        <Plus className="size-5" />
      </div>
      <span className="text-sm font-medium">항목 추가</span>
    </button>
  );
}

function WardrobeItemCard({
  item,
  category,
  identifier,
  onEdit,
}: {
  item: ChannelWardrobeItem;
  category?: ChannelWardrobeCategory;
  identifier: string;
  onEdit: () => void;
}) {
  const updateItem = useUpdateWardrobeItem(identifier);
  const deleteItem = useDeleteWardrobeItem(identifier);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const categoryAspectRatio = normalizeWardrobeAspectRatio(
    category?.defaultAspectRatio,
  );
  const descriptionText = extractWardrobeDescriptionText(item.description);
  const tags = item.tags ?? [];

  const toggleVisible = async () => {
    try {
      await updateItem.mutateAsync({
        itemId: item.id,
        input: { isVisible: !item.isVisible },
      });
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "공개 상태 변경에 실패했습니다."));
    }
  };

  const remove = async () => {
    try {
      await deleteItem.mutateAsync(item.id);
      toast.success("항목을 삭제했습니다.");
      setDeleteOpen(false);
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "항목 삭제에 실패했습니다."));
    }
  };

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-lg border bg-card shadow-sm transition hover:shadow-md",
        !item.isVisible && "opacity-70",
      )}
    >
      <button
        type="button"
        onClick={onEdit}
        className="relative block w-full overflow-hidden bg-muted text-left"
        style={getWardrobeAspectRatioStyle(categoryAspectRatio)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.imageUrl}
          alt={item.title}
          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100">
          <span className="flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold text-foreground shadow">
            <Pencil className="size-3.5" />
            편집
          </span>
        </div>
        <div className="absolute left-2 top-2">
          <Badge
            variant={item.isVisible ? "default" : "secondary"}
            className="gap-1 shadow-sm"
          >
            {item.isVisible ? (
              <Eye className="size-3" />
            ) : (
              <EyeOff className="size-3" />
            )}
            {item.isVisible ? "공개" : "숨김"}
          </Badge>
        </div>
      </button>

      <div className="absolute right-2 top-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="항목 메뉴"
              className="flex size-8 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition hover:bg-black/65"
            >
              <MoreVertical className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="size-4" />
              편집
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={toggleVisible}
              disabled={updateItem.isPending}
            >
              {item.isVisible ? (
                <>
                  <EyeOff className="size-4" />
                  숨기기
                </>
              ) : (
                <>
                  <Eye className="size-4" />
                  공개하기
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="size-4" />
              삭제
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="space-y-1.5 p-3">
        <div className="flex items-center gap-2">
          <h3 className="line-clamp-1 flex-1 text-sm font-semibold">
            {item.title}
          </h3>
          {category && (
            <Badge variant="outline" className="shrink-0 text-[10px]">
              {category.name}
            </Badge>
          )}
        </div>
        {descriptionText ? (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {descriptionText}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground/50">설명 없음</p>
        )}
        {tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
              >
                #{tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>항목을 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              {item.title} 항목이 옷장에서 영구히 삭제됩니다. 이 작업은 되돌릴 수
              없어요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={remove}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ImageUploadField({
  value,
  aspectRatio,
  onChange,
}: {
  value: string;
  aspectRatio?: string;
  onChange: (url: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = useImageUpload({
    onSuccess: (uploaded) => onChange(uploaded.imageUrl),
  });

  const onSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!validateImageFile(file)) {
      event.currentTarget.value = "";
      return;
    }
    await upload.uploadImage(file);
    event.currentTarget.value = "";
  };

  return (
    <button
      type="button"
      onClick={() => fileRef.current?.click()}
      disabled={upload.isUploading}
      className="group relative flex w-full items-center justify-center overflow-hidden rounded-xl border-2 border-dashed bg-muted/30 transition hover:border-primary/40 hover:bg-muted/50"
      style={getWardrobeAspectRatioStyle(aspectRatio)}
    >
      {upload.isUploading ? (
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      ) : value ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="옷장 항목 미리보기"
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/0 text-sm font-medium text-white opacity-0 transition group-hover:bg-black/45 group-hover:opacity-100">
            <Camera className="size-4" />
            이미지 변경
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <ImagePlus className="size-7" />
          <span className="text-sm font-medium">이미지 업로드</span>
          <span className="text-xs">클릭하여 선택 · 최대 10MB</span>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onSelect}
      />
    </button>
  );
}

function normalizeDraftTag(value: string): string {
  return value
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, " ")
    .slice(0, WARDROBE_TAG_MAX_LENGTH);
}

function TagInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const [input, setInput] = useState("");

  const addTags = (rawValues: string[]) => {
    const next = [...value];
    const seen = new Set(next.map((tag) => tag.toLocaleLowerCase()));

    for (const raw of rawValues) {
      const tag = normalizeDraftTag(raw);
      if (!tag) continue;
      const key = tag.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      next.push(tag);
      if (next.length >= WARDROBE_TAG_MAX_COUNT) break;
    }

    onChange(next);
    setInput("");
  };

  const removeTag = (tag: string) => {
    onChange(value.filter((candidate) => candidate !== tag));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <Tags className="size-4 text-muted-foreground" />
        태그
      </div>
      <div className="rounded-md border bg-background p-2">
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs font-medium"
            >
              #{tag}
              <button
                type="button"
                aria-label={`${tag} 태그 제거`}
                className="rounded-full text-muted-foreground transition hover:text-foreground"
                onClick={() => removeTag(tag)}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addTags([input]);
              }
              if (e.key === "Backspace" && !input && value.length > 0) {
                removeTag(value[value.length - 1]);
              }
            }}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              if (!text.includes(",")) return;
              e.preventDefault();
              addTags(text.split(","));
            }}
            onBlur={() => {
              if (input.trim()) addTags([input]);
            }}
            disabled={value.length >= WARDROBE_TAG_MAX_COUNT}
            className="min-w-[8rem] flex-1 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
            placeholder={
              value.length >= WARDROBE_TAG_MAX_COUNT
                ? "최대 12개"
                : "태그 추가"
            }
          />
        </div>
      </div>
    </div>
  );
}

const EMPTY_DRAFT = {
  title: "",
  categoryId: "",
  imageUrl: "",
  description: "",
  tags: [] as string[],
  isVisible: true,
  order: "0",
};

function WardrobeItemDialog({
  open,
  onOpenChange,
  mode,
  item,
  categories,
  identifier,
  defaultCategoryId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  item: ChannelWardrobeItem | null;
  categories: ChannelWardrobeCategory[];
  identifier: string;
  defaultCategoryId?: number;
}) {
  const createItem = useCreateWardrobeItem(identifier);
  const updateItem = useUpdateWardrobeItem(identifier);
  const deleteItem = useDeleteWardrobeItem(identifier);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && item) {
      setDraft({
        title: item.title,
        categoryId: String(item.categoryId),
        imageUrl: item.imageUrl,
        description: item.description ?? "",
        tags: item.tags ?? [],
        isVisible: item.isVisible,
        order: String(item.order),
      });
      return;
    }
    setDraft({
      ...EMPTY_DRAFT,
      categoryId: String(defaultCategoryId ?? categories[0]?.id ?? ""),
    });
  }, [open, mode, item, defaultCategoryId, categories]);

  const isPending = createItem.isPending || updateItem.isPending;
  const selectedCategory = categories.find(
    (category) => String(category.id) === draft.categoryId,
  );

  const submit = async () => {
    const title = draft.title.trim();
    const imageUrl = draft.imageUrl.trim();
    const categoryId = Number(draft.categoryId || categories[0]?.id);
    if (!imageUrl) {
      toast.error("이미지를 업로드해주세요.");
      return;
    }
    if (!title) {
      toast.error("항목 이름을 입력해주세요.");
      return;
    }
    if (!Number.isFinite(categoryId)) {
      toast.error("분류를 선택해주세요.");
      return;
    }

    try {
      if (mode === "edit" && item) {
        await updateItem.mutateAsync({
          itemId: item.id,
          input: {
            title,
            categoryId,
            imageUrl,
            description: draft.description.trim(),
            tags: draft.tags,
            isVisible: draft.isVisible,
            order: Number(draft.order) || 0,
          },
        });
        toast.success("항목을 저장했습니다.");
      } else {
        await createItem.mutateAsync({
          title,
          imageUrl,
          categoryId,
          description: draft.description.trim() || undefined,
          tags: draft.tags,
        });
        toast.success("옷장 항목을 추가했습니다.");
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(
        extractApiErrorMessage(
          err,
          mode === "edit"
            ? "항목 저장에 실패했습니다."
            : "항목 추가에 실패했습니다.",
        ),
      );
    }
  };

  const remove = async () => {
    if (!item) return;
    try {
      await deleteItem.mutateAsync(item.id);
      toast.success("항목을 삭제했습니다.");
      setDeleteOpen(false);
      onOpenChange(false);
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "항목 삭제에 실패했습니다."));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "edit" ? "항목 편집" : "옷장 항목 추가"}
          </DialogTitle>
          <DialogDescription>
            시청자에게 보여줄 이미지와 정보를 입력하세요.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <ImageUploadField
            value={draft.imageUrl}
            aspectRatio={selectedCategory?.defaultAspectRatio}
            onChange={(url) =>
              setDraft((current) => ({ ...current, imageUrl: url }))
            }
          />

          <SettingsCompactProvider compact>
            <div className="rounded-md border px-4">
              <SettingsRow title="분류">
                <Select
                  value={draft.categoryId}
                  onValueChange={(value) =>
                    setDraft((current) => ({ ...current, categoryId: value }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="분류 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((category) => (
                      <SelectItem key={category.id} value={String(category.id)}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingsRow>

              <SettingsRow title="이름">
                <Input
                  value={draft.title}
                  onChange={(e) =>
                    setDraft((current) => ({
                      ...current,
                      title: e.target.value,
                    }))
                  }
                  maxLength={40}
                  placeholder="예: 빈티지"
                />
              </SettingsRow>

              {mode === "edit" && (
                <>
                  <SettingsRow
                    title="옷장에 공개"
                    controlClassName="flex justify-start sm:justify-end"
                  >
                    <div className="flex items-center gap-2">
                      {draft.isVisible ? (
                        <Eye className="size-4 text-primary" />
                      ) : (
                        <EyeOff className="size-4 text-muted-foreground" />
                      )}
                      <Switch
                        checked={draft.isVisible}
                        onCheckedChange={(value) =>
                          setDraft((current) => ({
                            ...current,
                            isVisible: value,
                          }))
                        }
                        aria-label="옷장 공개 여부"
                      />
                    </div>
                  </SettingsRow>
                  <SettingsRow title="순서">
                    <Input
                      type="number"
                      min={0}
                      value={draft.order}
                      onChange={(e) =>
                        setDraft((current) => ({
                          ...current,
                          order: e.target.value,
                        }))
                      }
                      className="w-20"
                    />
                  </SettingsRow>
                </>
              )}
            </div>
          </SettingsCompactProvider>

          <div className="space-y-2">
            <div className="text-sm font-medium">설명</div>
            <EditorTiptap
              key={`${mode}-${item?.id ?? "new"}-${open ? "open" : "closed"}`}
              defaultValue={draft.description}
              onTextChange={(...args) => {
                const html = typeof args[3] === "string" ? args[3] : "";
                setDraft((current) => ({
                  ...current,
                  description: html,
                }));
              }}
            />
          </div>

          <TagInput
            value={draft.tags}
            onChange={(tags) =>
              setDraft((current) => ({
                ...current,
                tags,
              }))
            }
          />
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {mode === "edit" && (
            <Button
              type="button"
              variant="ghost"
              className="mr-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="size-4" />
              삭제
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            취소
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={isPending || !draft.imageUrl}
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : mode === "edit" ? (
              <Check className="size-4" />
            ) : (
              <Plus className="size-4" />
            )}
            {mode === "edit" ? "저장" : "추가"}
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>항목을 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              {item?.title} 항목이 옷장에서 영구히 삭제됩니다. 이 작업은 되돌릴
              수 없어요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={remove}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

function CategoryManagerDialog({
  open,
  onOpenChange,
  identifier,
  categories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  identifier: string;
  categories: ChannelWardrobeCategory[];
}) {
  const createCategory = useCreateWardrobeCategory(identifier);
  const [newName, setNewName] = useState("");
  const [newAspectRatio, setNewAspectRatio] = useState<WardrobeAspectRatio>(
    DEFAULT_WARDROBE_ASPECT_RATIO,
  );

  const add = async () => {
    const name = newName.trim();
    if (!name) {
      toast.error("분류 이름을 입력해주세요.");
      return;
    }
    try {
      await createCategory.mutateAsync({
        name,
        defaultAspectRatio: newAspectRatio,
      });
      setNewName("");
      setNewAspectRatio(DEFAULT_WARDROBE_ASPECT_RATIO);
      toast.success("분류를 추가했습니다.");
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "분류 추가에 실패했습니다."));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>분류 관리</DialogTitle>
          <DialogDescription>
            공개 옷장 상단에 표시되는 분류 탭입니다. 순서, 표시 여부, 카드
            비율을 조정할 수 있어요.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
          {categories.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              아직 분류가 없어요. 아래에서 첫 분류를 추가해보세요.
            </p>
          ) : (
            categories.map((category, index) => (
              <CategoryManagerRow
                key={category.id}
                identifier={identifier}
                category={category}
                canDelete={categories.length > 1}
                prev={index > 0 ? categories[index - 1] : undefined}
                next={
                  index < categories.length - 1
                    ? categories[index + 1]
                    : undefined
                }
              />
            ))
          )}
        </div>

        <div className="space-y-3 border-t pt-4">
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="새 분류 이름 (예: 액세서리)"
              maxLength={40}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void add();
                }
              }}
            />
            <Button
              type="button"
              onClick={add}
              disabled={createCategory.isPending}
            >
              {createCategory.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              추가
            </Button>
          </div>
          <AspectRatioPicker
            value={newAspectRatio}
            onChange={setNewAspectRatio}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AspectRatioPicker({
  value,
  onChange,
  disabled,
  compact,
}: {
  value: WardrobeAspectRatio;
  onChange: (value: WardrobeAspectRatio) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {WARDROBE_ASPECT_RATIOS.map((ratio) => {
        const meta = WARDROBE_ASPECT_RATIO_META[ratio];
        const active = ratio === value;
        const isTall = meta.height > meta.width;
        const isSquare = meta.height === meta.width;

        return (
          <button
            key={ratio}
            type="button"
            aria-label={`${ratio} 비율`}
            disabled={disabled}
            onClick={() => onChange(ratio)}
            className={cn(
              "flex shrink-0 flex-col items-center justify-center gap-1 rounded-md border bg-background text-xs font-semibold transition",
              compact ? "h-12 min-w-[3.25rem] px-2" : "h-16 min-w-[4rem] px-2.5",
              active
                ? "border-primary bg-primary/10 text-primary"
                : "text-muted-foreground hover:border-primary/50 hover:text-foreground",
              disabled && "pointer-events-none opacity-60",
            )}
          >
            <span
              className={cn(
                "block rounded-[3px] border-2",
                active ? "border-primary bg-primary/20" : "border-current/60",
              )}
              style={{
                aspectRatio: meta.cssValue,
                width: isTall ? undefined : isSquare ? 22 : 30,
                height: isTall ? 28 : undefined,
              }}
            />
            <span>{meta.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function CategoryManagerRow({
  identifier,
  category,
  canDelete,
  prev,
  next,
}: {
  identifier: string;
  category: ChannelWardrobeCategory;
  canDelete: boolean;
  prev?: ChannelWardrobeCategory;
  next?: ChannelWardrobeCategory;
}) {
  const updateCategory = useUpdateWardrobeCategory(identifier);
  const deleteCategory = useDeleteWardrobeCategory(identifier);
  const [name, setName] = useState(category.name);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const aspectRatio = normalizeWardrobeAspectRatio(category.defaultAspectRatio);

  useEffect(() => {
    setName(category.name);
  }, [category.name]);

  const commitName = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === category.name) {
      setName(category.name);
      return;
    }
    try {
      await updateCategory.mutateAsync({
        categoryId: category.id,
        input: { name: trimmed },
      });
    } catch (err) {
      setName(category.name);
      toast.error(extractApiErrorMessage(err, "분류 이름 변경에 실패했습니다."));
    }
  };

  const toggle = async (isEnabled: boolean) => {
    try {
      await updateCategory.mutateAsync({
        categoryId: category.id,
        input: { isEnabled },
      });
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "분류 상태 변경에 실패했습니다."));
    }
  };

  const changeAspectRatio = async (defaultAspectRatio: WardrobeAspectRatio) => {
    if (defaultAspectRatio === aspectRatio) return;
    try {
      await updateCategory.mutateAsync({
        categoryId: category.id,
        input: { defaultAspectRatio },
      });
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "분류 비율 변경에 실패했습니다."));
    }
  };

  const move = async (target?: ChannelWardrobeCategory) => {
    if (!target) return;
    try {
      await updateCategory.mutateAsync({
        categoryId: category.id,
        input: { order: target.order },
      });
      await updateCategory.mutateAsync({
        categoryId: target.id,
        input: { order: category.order },
      });
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "분류 순서 변경에 실패했습니다."));
    }
  };

  const remove = async () => {
    try {
      await deleteCategory.mutateAsync(category.id);
      toast.success("분류를 삭제했습니다.");
      setDeleteOpen(false);
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "분류 삭제에 실패했습니다."));
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border px-2 py-2",
        !category.isEnabled && "bg-muted/40",
      )}
    >
      <div className="flex items-center gap-2">
        <div className="flex flex-col">
          <button
            type="button"
            aria-label="위로"
            onClick={() => move(prev)}
            disabled={!prev || updateCategory.isPending}
            className="text-muted-foreground transition hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronUp className="size-4" />
          </button>
          <button
            type="button"
            aria-label="아래로"
            onClick={() => move(next)}
            disabled={!next || updateCategory.isPending}
            className="text-muted-foreground transition hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronDown className="size-4" />
          </button>
        </div>

        <Switch
          checked={category.isEnabled}
          onCheckedChange={toggle}
          disabled={updateCategory.isPending}
        />

        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          maxLength={40}
          className={cn(
            "h-8 min-w-0 flex-1",
            !category.isEnabled && "text-muted-foreground",
          )}
        />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={() => setDeleteOpen(true)}
          disabled={!canDelete || deleteCategory.isPending}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      <div className="mt-2 pl-16">
        <AspectRatioPicker
          compact
          value={aspectRatio}
          onChange={changeAspectRatio}
          disabled={updateCategory.isPending}
        />
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>분류를 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              {category.name} 분류를 삭제합니다. 이 분류에 속한 항목이 있다면
              먼저 다른 분류로 옮기거나 삭제해주세요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={remove}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
