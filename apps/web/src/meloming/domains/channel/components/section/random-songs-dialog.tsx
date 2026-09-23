import { useEffect, useState } from "react";
import { Button } from "@/meloming/shared/components/ui/button";
import { Badge } from "@/meloming/shared/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/meloming/shared/components/ui/dialog";
import { Input } from "@/meloming/shared/components/ui/input";
import MusicCard from "@/meloming/domains/channel/components/musicbook/music-card";
import { useRandomPublicUserSongs } from "@/meloming/domains/channel/hooks/use-songs";
import { useUserCategories } from "@/meloming/domains/channel/hooks/use-categories";
import { useChannel } from "@/meloming/domains/channel/hooks/use-channel";
import { usePricingSettings } from "@/meloming/domains/channel/hooks/use-pricing-settings";
import type { Category } from "@/meloming/domains/channel/types/category";
import type { LiveSongRequestState } from "@/meloming/domains/channel/types/live-song-request";
import { sortCategories } from "@/meloming/domains/channel/utils/category-sort";
import { getContrastingTextColor } from "@/meloming/shared/lib/utils";
import { canBeChoseong, getChoseong } from "es-hangul";
import { ChevronDown, Loader2, RefreshCw } from "lucide-react";
import { LOCAL_STORAGE_KEYS } from "@/meloming/shared/constants/storage";

interface RandomSongsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  identifier: string;
  liveRequestState?: LiveSongRequestState;
}

const SINGLE_COUNT = 1;
const MULTIPLE_COUNT = 4;

function normalizeCategoryIds(categoryIds: readonly number[]): number[] {
  if (categoryIds.length === 0) {
    return [];
  }

  const unique = new Set<number>();
  for (const id of categoryIds) {
    if (Number.isInteger(id) && id > 0) {
      unique.add(id);
    }
  }

  return Array.from(unique).sort((a, b) => a - b);
}

function RandomSongsCategorySelectDialog({
  open,
  onOpenChange,
  categories,
  value,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Category[] | undefined;
  value: readonly number[];
  onChange: (next: number[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<number[]>([]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setQuery("");
    setDraft(normalizeCategoryIds(value));
  }, [open, value]);

  const sortedCategories = sortCategories(
    (categories ?? []).filter((category) => (category.songCount || 0) > 0)
  );

  const q = query.trim();
  const filteredCategories = q
    ? (() => {
        const isChoseongOnly = [...q].every((ch) => canBeChoseong(ch));
        if (isChoseongOnly) {
          return sortedCategories.filter((category) =>
            getChoseong(category.name).includes(q)
          );
        }
        const lowerQ = q.toLowerCase();
        return sortedCategories.filter((category) =>
          category.name.toLowerCase().includes(lowerQ)
        );
      })()
    : sortedCategories;

  const toggleDraft = (categoryId: number) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return Array.from(next);
    });
  };

  const handleClear = () => {
    setDraft([]);
  };

  const handleApply = () => {
    onChange(normalizeCategoryIds(draft));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[80vh] overflow-y-auto"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>카테고리 선택</DialogTitle>
        </DialogHeader>

        <div className="mb-2">
          <Input
            placeholder="카테고리 검색 (초성 가능)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus={false}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant={draft.length === 0 ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs px-3 py-1"
            onClick={handleClear}
          >
            전체 (선택 해제)
          </Button>

          {filteredCategories.map((category) => {
            const isSelected = draft.includes(category.id);
            return (
              <Badge
                key={category.id}
                variant={isSelected ? "default" : "outline"}
                className="px-3 py-1 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-1 transition-colors"
                style={{
                  borderColor: category.color,
                  ...(isSelected && {
                    backgroundColor: category.color,
                    borderColor: category.color,
                    color: getContrastingTextColor(category.color),
                  }),
                }}
                onClick={() => toggleDraft(category.id)}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{
                    backgroundColor: isSelected
                      ? getContrastingTextColor(category.color) === "white"
                        ? "rgba(255,255,255,0.8)"
                        : "rgba(0,0,0,0.8)"
                      : category.color,
                  }}
                />
                {category.name}
              </Badge>
            );
          })}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button onClick={handleApply}>적용</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function RandomSongsDialog({
  open,
  onOpenChange,
  identifier,
  liveRequestState,
}: RandomSongsDialogProps) {
  const { data: channel } = useChannel(identifier);
  const { data: pricingSettings } = usePricingSettings(channel?.id);

  // SSR 과 첫 CSR render 에서 동일한 기본값(true)으로 시작해야 hydration mismatch
  // 방지 (React error #418). localStorage 는 mount 후 useEffect 에서 읽음.
  const [isMultipleMode, setIsMultipleMode] = useState<boolean>(true);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(
        LOCAL_STORAGE_KEYS.RANDOM_SONGS_MULTIPLE_MODE
      );
      if (stored !== null) setIsMultipleMode(stored === "true");
    } catch {}
  }, []);

  const count = isMultipleMode ? MULTIPLE_COUNT : SINGLE_COUNT;

  const { data: categories } = useUserCategories(identifier, { enabled: open });
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);
  const [isCategorySelectOpen, setIsCategorySelectOpen] = useState(false);
  const hasCategoryFilter = selectedCategoryIds.length > 0;

  useEffect(() => {
    if (!open) {
      setIsCategorySelectOpen(false);
    }
  }, [open]);

  const selectedCategoryNames =
    categories
      ?.filter((category) => selectedCategoryIds.includes(category.id))
      .map((category) => category.name) ?? [];

  const categoryButtonLabel = (() => {
    if (!hasCategoryFilter) {
      return "카테고리 전체";
    }
    if (selectedCategoryNames.length === 1) {
      return selectedCategoryNames[0];
    }
    if (selectedCategoryNames.length > 1) {
      return `${selectedCategoryNames[0]} 외 ${
        selectedCategoryNames.length - 1
      }개`;
    }
    return `카테고리 ${selectedCategoryIds.length}개`;
  })();

  const {
    data: randomData,
    isLoading,
    isRefetching,
    error,
    refetch,
  } = useRandomPublicUserSongs(
    identifier,
    { count, categoryIds: selectedCategoryIds },
    { enabled: open }
  );

  // isMultipleMode가 변경될 때 Local Storage에 저장
  useEffect(() => {
    try {
      localStorage.setItem(
        LOCAL_STORAGE_KEYS.RANDOM_SONGS_MULTIPLE_MODE,
        String(isMultipleMode)
      );
    } catch {
      // Local Storage 접근 실패 시 무시
    }
  }, [isMultipleMode]);

  const handleModeChange = (checked: boolean) => {
    setIsMultipleMode(checked);
  };

  const randomSongs = randomData?.songs ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>랜덤 노래 뽑기</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2 mb-2">
          <div className="flex justify-between items-start gap-3">
            <div className="text-sm text-gray-500">
              {error
                ? "불러오기에 실패했습니다. 다시 시도해주세요."
                : hasCategoryFilter
                ? `선택한 카테고리에서 ${count}곡을 랜덤으로 뽑아봤어요`
                : `어떤 곡을 부를지 고민인가요? ${count}곡을 랜덤으로 뽑아봤어요`}
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleModeChange(!isMultipleMode)}
                className="gap-1"
              >
                {isMultipleMode ? "한 곡만 뽑기" : "여러 곡 뽑기"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isLoading || isRefetching}
                className="gap-1"
              >
                <RefreshCw
                  size={12}
                  className={isRefetching ? "animate-spin" : ""}
                />
                다시 뽑기
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => setIsCategorySelectOpen(true)}
            >
              {categoryButtonLabel}
              <ChevronDown size={12} />
            </Button>
            {hasCategoryFilter && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs px-3 py-1"
                onClick={() => setSelectedCategoryIds([])}
              >
                초기화
              </Button>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-gray-500">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> 불러오는 중...
          </div>
        ) : error ? (
          <div className="text-sm text-red-500">
            문제가 발생했습니다. 잠시 후 다시 시도해주세요.
          </div>
        ) : randomSongs.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-gray-500 text-sm">
            {hasCategoryFilter
              ? "선택한 카테고리에 해당하는 노래가 없습니다."
              : "노래가 없습니다."}
          </div>
        ) : (
          <div
            className={
              isMultipleMode
                ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 mt-2"
                : "flex justify-center mt-2"
            }
          >
            {randomSongs.map((song) => (
              <div
                key={song.id}
                className={isMultipleMode ? "" : "w-full max-w-48"}
              >
                <MusicCard
                  song={song}
                  hideFavorite
                  pricingSettings={pricingSettings}
                  liveRequestState={liveRequestState}
                />
              </div>
            ))}
          </div>
        )}

        <RandomSongsCategorySelectDialog
          open={isCategorySelectOpen}
          onOpenChange={setIsCategorySelectOpen}
          categories={categories}
          value={selectedCategoryIds}
          onChange={setSelectedCategoryIds}
        />
      </DialogContent>
    </Dialog>
  );
}
