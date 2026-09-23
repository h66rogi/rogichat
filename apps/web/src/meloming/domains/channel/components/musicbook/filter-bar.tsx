import { useEffect, useState } from "react";
import { Button } from "@/meloming/shared/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/meloming/shared/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/meloming/shared/components/ui/tooltip";
import { ChevronDown, RotateCcw, Search } from "lucide-react";
import { Input } from "@/meloming/shared/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/meloming/shared/components/ui/radio-group";
import { Label } from "@/meloming/shared/components/ui/label";
import { debounce } from "es-toolkit";
import { useMusicbookFilters } from "@/meloming/domains/channel/hooks/use-musicbook-filters";
import { useUserCategories } from "@/meloming/domains/channel/hooks/use-categories";
import { useUserArtists } from "@/meloming/domains/channel/hooks/use-artists";
import { ArtistSelectDialog } from "./artist-select-dialog";
import { CategorySelectDialog } from "./category-select-dialog";
import StarList from "./star-list";
import type { SongPrimaryRatingField } from "./song-rating-badges";

interface FilterBarProps {
  username: string;
  filters: ReturnType<typeof useMusicbookFilters>["filters"];
  setSearchQuery: (query: string | undefined) => void;
  setCategories: (categoryIds: readonly string[]) => void;
  setArtists: (artistIds: readonly string[]) => void;
  ratingValue: string | null;
  ratingLabel: string;
  ratingField: SongPrimaryRatingField;
  setRating: (rating: string | undefined) => void;
  clearFilters: () => void;
}

const SEARCH_DEBOUNCE_DELAY_MS = 300;

export function FilterBar({
  username,
  filters,
  setSearchQuery,
  setCategories,
  setArtists,
  ratingValue,
  ratingLabel,
  ratingField,
  setRating,
  clearFilters,
}: FilterBarProps) {
  const { searchQuery, categoryIds, artistIds } = filters;
  const ratingTone = ratingField === "proficiency" ? "green" : "yellow";

  const [openPopover, setOpenPopover] = useState<string | null>(null);
  const [localSearchQuery, setLocalSearchQuery] = useState(searchQuery || "");
  const [isArtistDialogOpen, setIsArtistDialogOpen] = useState(false);
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);

  const { data: categories } = useUserCategories(username);
  const { data: artists } = useUserArtists(username);

  // Sync local search with filter search
  useEffect(() => {
    setLocalSearchQuery(searchQuery || "");
  }, [searchQuery]);

  // Debounced search handler
  const [debouncedSetSearchQuery] = useState(() =>
    debounce((query: string) => {
      setSearchQuery(query || undefined);
    }, SEARCH_DEBOUNCE_DELAY_MS)
  );

  useEffect(() => {
    debouncedSetSearchQuery(localSearchQuery);
    return () => {
      debouncedSetSearchQuery.cancel();
    };
  }, [localSearchQuery, debouncedSetSearchQuery]);

  const handleDifficultyChange = (value: string) => {
    setRating(value === "all" ? undefined : value);
    setOpenPopover(null);
  };

  // Check if filters are active
  const hasSearchFilter = Boolean(searchQuery && searchQuery.trim().length > 0);
  const hasCategoryFilter = categoryIds.length > 0;
  const hasArtistFilter = artistIds.length > 0;
  const hasDifficultyFilter = Boolean(ratingValue);
  const hasActiveFilter =
    hasSearchFilter ||
    hasCategoryFilter ||
    hasArtistFilter ||
    hasDifficultyFilter;

  const selectedCategories =
    categories?.filter((c) => categoryIds.includes(c.id.toString())) ?? [];
  const selectedArtists =
    artists?.filter((a) => artistIds.includes(a.id.toString())) ?? [];
  const categoryLabel =
    categoryIds.length === 0
      ? "카테고리 전체"
      : categoryIds.length === 1
        ? selectedCategories[0]?.name ?? "카테고리 1개"
        : `카테고리 ${categoryIds.length}개`;
  const artistLabel =
    artistIds.length === 0
      ? "가수 전체"
      : artistIds.length === 1
        ? selectedArtists[0]?.name ?? "가수 1개"
        : `가수 ${artistIds.length}개`;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {/* 키워드 검색 */}
        <Tooltip>
          <Popover
            open={openPopover === "keyword"}
            onOpenChange={(open) => setOpenPopover(open ? "keyword" : null)}
          >
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={`gap-1 md:gap-1.5 md:h-10 md:px-4 ${
                    hasSearchFilter
                      ? "border-indigo-500 dark:border-indigo-500"
                      : ""
                  }`}
                >
                  <Search className="size-3 md:size-4" />
                  <span className="text-xs md:text-sm">
                    {hasSearchFilter && localSearchQuery.length > 10
                      ? `${localSearchQuery.slice(0, 10)}...`
                      : hasSearchFilter
                      ? localSearchQuery
                      : "검색"}
                  </span>
                  <ChevronDown className="size-3 md:size-4" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <PopoverContent
              className="w-80 max-w-[calc(100vw-2rem)] p-4"
              align="start"
            >
              <div className="space-y-2">
                <label className="text-sm font-medium">제목 또는 가수명</label>
                <Input
                  placeholder="검색어를 입력하세요"
                  value={localSearchQuery}
                  onChange={(e) => setLocalSearchQuery(e.target.value)}
                  className="mt-2"
                />
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setLocalSearchQuery("");
                    setSearchQuery(undefined);
                    setOpenPopover(null);
                  }}
                >
                  초기화
                </Button>
                <Button size="sm" onClick={() => setOpenPopover(null)}>
                  확인
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <TooltipContent>제목·가수를 검색할 수 있어요</TooltipContent>
        </Tooltip>

        {/* 카테고리 필터 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={`gap-1 md:gap-1.5 md:h-10 md:px-4 ${
                hasCategoryFilter
                  ? "border-indigo-500 dark:border-indigo-500"
                  : ""
              }`}
              onClick={() => setIsCategoryDialogOpen(true)}
            >
              <span className="text-xs md:text-sm">{categoryLabel}</span>
              <ChevronDown className="size-3 md:size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>카테고리를 검색하고 선택할 수 있어요</TooltipContent>
        </Tooltip>

        {/* 가수 필터 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={`gap-1 md:gap-1.5 md:h-10 md:px-4 ${
                hasArtistFilter
                  ? "border-indigo-500 dark:border-indigo-500"
                  : ""
              }`}
              onClick={() => setIsArtistDialogOpen(true)}
            >
              <span className="text-xs md:text-sm">{artistLabel}</span>
              <ChevronDown className="size-3 md:size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>가수를 검색하고 선택할 수 있어요</TooltipContent>
        </Tooltip>

        {/* 난이도 필터 */}
        <Tooltip>
          <Popover
            open={openPopover === "difficulty"}
            onOpenChange={(open) => setOpenPopover(open ? "difficulty" : null)}
          >
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={`gap-1 md:gap-1.5 md:h-10 md:px-4 ${
                    hasDifficultyFilter
                      ? "border-indigo-500 dark:border-indigo-500"
                      : ""
                  }`}
                >
                  <span className="text-xs md:text-sm">
                    {hasDifficultyFilter
                      ? `${ratingLabel} ${ratingValue}`
                      : `${ratingLabel} 전체`}
                  </span>
                  <ChevronDown className="size-3 md:size-4" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <PopoverContent
              className="w-auto max-w-[calc(100vw-2rem)] p-4"
              align="start"
            >
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {ratingLabel} 선택
                </label>
                <RadioGroup
                  onValueChange={handleDifficultyChange}
                  value={ratingValue || "all"}
                  className="flex flex-col gap-2 mt-2"
                >
                  <div className="flex flex-row gap-2 items-center">
                    <RadioGroupItem value="all" id="bar-star-all" />
                    <Label htmlFor="bar-star-all">전체</Label>
                  </div>

                  {[1, 2, 3, 4, 5].map((star) => (
                    <div
                      key={star}
                      className="flex flex-row gap-2 items-center"
                    >
                      <RadioGroupItem
                        value={star.toString()}
                        id={`bar-star-${star}`}
                      />
                      <Label htmlFor={`bar-star-${star}`} className="gap-0.5">
                        <StarList star={star} size={14} tone={ratingTone} />
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>
            </PopoverContent>
          </Popover>
          <TooltipContent>{ratingLabel}를 선택할 수 있어요</TooltipContent>
        </Tooltip>

        {hasActiveFilter && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-9 flex-none gap-1 px-2.5 text-xs md:h-10 md:px-3 md:text-sm"
                onClick={() => {
                  setLocalSearchQuery("");
                  clearFilters();
                }}
              >
                <RotateCcw className="size-3 md:size-4" />
                <span>초기화</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>노래책 필터를 모두 초기화해요</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Category Select Dialog */}
      <CategorySelectDialog
        open={isCategoryDialogOpen}
        onOpenChange={setIsCategoryDialogOpen}
        categories={categories}
        selectedCategoryIds={categoryIds}
        onSelect={setCategories}
      />

      {/* Artist Select Dialog */}
      <ArtistSelectDialog
        open={isArtistDialogOpen}
        onOpenChange={setIsArtistDialogOpen}
        artists={artists}
        selectedArtistIds={artistIds}
        onSelect={setArtists}
      />
    </>
  );
}
