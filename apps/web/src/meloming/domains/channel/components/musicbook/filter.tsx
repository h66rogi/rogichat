import clsx from "clsx";
import { Input } from "@/meloming/shared/components/ui/input";
import { RotateCcw, Search, X } from "lucide-react";
import { Button } from "@/meloming/shared/components/ui/button";
import { PencilIcon } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/meloming/shared/components/ui/radio-group";
import { Label } from "@/meloming/shared/components/ui/label";
import { Badge } from "@/meloming/shared/components/ui/badge";
import { InlineError } from "@/meloming/shared/components/common/error-boundary";
import { useUserCategories } from "@/meloming/domains/channel/hooks/use-categories";
import { useUserArtists } from "@/meloming/domains/channel/hooks/use-artists";
import { useState, useEffect } from "react";
import StarList from "./star-list";
import { getContrastingTextColor } from "@/meloming/shared/lib/utils";
import { useIsMobile } from "@/meloming/shared/hooks/use-mobile";
import { useMusicbookFilters } from "@/meloming/domains/channel/hooks/use-musicbook-filters";
import { SkeletonBadgeList } from "@/meloming/shared/components/skeleton";
import { debounce } from "es-toolkit";
import Link from "next/link";
import { useChannelPermission } from "@/meloming/domains/channel/hooks/use-channel";
import { ArtistSelectDialog } from "./artist-select-dialog";
import { CategorySelectDialog } from "./category-select-dialog";
import { sortCategories } from "@/meloming/domains/channel/utils/category-sort";
import type { SongPrimaryRatingField } from "./song-rating-badges";

interface FilterProps {
  isSticky: boolean;
  username: string;
  filters: ReturnType<typeof useMusicbookFilters>["filters"];
  setSearchQuery: (query: string | undefined) => void;
  setCategories: (categoryIds: readonly string[]) => void;
  toggleCategory: (categoryId: string) => void;
  setArtists: (artistIds: readonly string[]) => void;
  toggleArtist: (artistId: string) => void;
  ratingValue: string | null;
  ratingLabel: string;
  ratingField: SongPrimaryRatingField;
  setRating: (rating: string | undefined) => void;
  clearFilters: () => void;
  noTopPadding?: boolean;
  offsetTopClass?: string;
}

const SEARCH_DEBOUNCE_DELAY_MS = 300;

export default function FilterSection({
  isSticky,
  username,
  filters,
  setSearchQuery,
  setCategories,
  toggleCategory,
  setArtists,
  toggleArtist,
  ratingValue,
  ratingLabel,
  ratingField,
  setRating,
  clearFilters,
  noTopPadding,
  offsetTopClass,
}: FilterProps) {
  const isMobile = useIsMobile();
  const { searchQuery, categoryIds, artistIds } = filters;
  const selectedCategoryIdSet = new Set(categoryIds);
  const selectedArtistIdSet = new Set(artistIds);

  const { data: userPermission } = useChannelPermission(username);
  const ratingTone = ratingField === "proficiency" ? "green" : "yellow";

  // 로컬 검색 상태 (즉시 반영)
  const [localSearchQuery, setLocalSearchQuery] = useState(searchQuery);

  // searchQuery가 외부에서 변경될 때 로컬 상태 동기화
  useEffect(() => {
    setLocalSearchQuery(searchQuery);
  }, [searchQuery]);

  // debounced 함수를 useState로 관리하여 컴포넌트 생명주기 동안 유지
  const [debouncedSetSearchQuery] = useState(() =>
    debounce((query: string) => {
      setSearchQuery(query || undefined);
    }, SEARCH_DEBOUNCE_DELAY_MS)
  );

  // 로컬 검색어가 변경될 때마다 debounced 함수 호출
  useEffect(() => {
    debouncedSetSearchQuery(localSearchQuery);

    // 컴포넌트 언마운트 시 타이머 정리
    return () => {
      debouncedSetSearchQuery.cancel();
    };
  }, [localSearchQuery, debouncedSetSearchQuery]);

  const {
    data: categories,
    isLoading: isCategoriesLoading,
    error: categoriesError,
    refetch: refetchCategories,
  } = useUserCategories(username);

  const {
    data: artists,
    isLoading: isArtistsLoading,
    error: artistsError,
    refetch: refetchArtists,
  } = useUserArtists(username);

  const [isArtistModalOpen, setIsArtistModalOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const ARTIST_DISPLAY_LIMIT = 15;
  const CATEGORY_DISPLAY_LIMIT = 15;

  const handleCategoryClick = (id: string) => {
    toggleCategory(id);
  };

  const handleArtistClick = (id: string) => {
    toggleArtist(id);
  };

  const handleDifficultyChange = (value: string) => {
    setRating(value === "all" ? undefined : value);
  };

  const handleSearchClear = () => {
    setLocalSearchQuery("");
    setSearchQuery(undefined);
  };
  const hasActiveFilter =
    Boolean(searchQuery && searchQuery.trim().length > 0) ||
    categoryIds.length > 0 ||
    artistIds.length > 0 ||
    Boolean(ratingValue);

  const handleClearFilters = () => {
    setLocalSearchQuery("");
    clearFilters();
  };

  return (
    <section
      id="channel-filter"
      className={clsx(
        "w-full flex flex-col gap-6",
        (!isMobile && isSticky && "sticky self-start") || undefined,
        !isMobile && "max-w-72",
        offsetTopClass || "top-[var(--channel-sticky-top)]",
        isSticky && !isMobile && !noTopPadding && "pt-0"
      )}
    >
      <div className="relative w-full">
        <Input
          id="channel-filter-search"
          placeholder="제목 또는 가수명 검색"
          className="w-full pr-10"
          value={localSearchQuery}
          onChange={(e) => setLocalSearchQuery(e.target.value)}
        />
        {localSearchQuery ? (
          <X
            size={16}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 cursor-pointer hover:text-gray-600 dark:hover:text-gray-300"
            onClick={handleSearchClear}
          />
        ) : (
          <Search
            size={16}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400"
          />
        )}
      </div>

      {hasActiveFilter && (
        <Button
          variant="outline"
          size="sm"
          className="h-9 w-full justify-center gap-2 text-xs"
          onClick={handleClearFilters}
        >
          <RotateCcw size={14} />
          필터 초기화
        </Button>
      )}

      <div id="channel-filter-category" className="flex flex-col gap-2 w-full">
        <div className="flex flex-row gap-2 items-center">
          <label
            htmlFor="search"
            className="text-sm font-semibold text-gray-900 dark:text-gray-100"
          >
            카테고리
          </label>
          {userPermission?.manageContent && (
            <Link
              href={`/channel/${username}/manage/categories`}
              className="cursor-pointer hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-gray-800 rounded-md p-1"
            >
              <PencilIcon size={12} />
            </Link>
          )}
        </div>

        <div className="flex flex-wrap gap-2 channel-filter-badges">
          {isCategoriesLoading ? (
            <SkeletonBadgeList count={6} badgeVariant="badge" />
          ) : categoriesError ? (
            <InlineError
              message="카테고리를 불러올 수 없습니다."
              size="sm"
              className="w-full"
              onRetry={refetchCategories}
            />
          ) : (
            <>
              {(() => {
                const sortedCategories =
                  categories
                    ?.filter((category) => (category.songCount || 0) > 0)
                    .slice() || [];

                // displayOrder 기준으로 정렬
                const orderedCategories = sortCategories(sortedCategories);

                const displayCategories = orderedCategories.slice(
                  0,
                  CATEGORY_DISPLAY_LIMIT
                );

                return (
                  <>
                    {displayCategories.map((category) => {
                      const isSelected = selectedCategoryIdSet.has(
                        category.id.toString()
                      );
                      return (
                        <Badge
                          key={category.id}
                          variant={isSelected ? "default" : "outline"}
                          className={`px-3 py-1 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-1 transition-colors`}
                          style={{
                            borderColor: category.color,
                            ...(isSelected && {
                              backgroundColor: category.color,
                              borderColor: category.color,
                              color: getContrastingTextColor(category.color),
                            }),
                          }}
                          onClick={() =>
                            handleCategoryClick(category.id.toString())
                          }
                        >
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{
                              backgroundColor: isSelected
                                ? getContrastingTextColor(category.color) ===
                                  "white"
                                  ? "rgba(255,255,255,0.8)"
                                  : "rgba(0,0,0,0.8)"
                                : category.color,
                            }}
                          />
                          {category.name}
                          {category.songCount !== undefined && (
                            <span
                              className={`text-xs ml-1 ${
                                !isSelected
                                  ? "text-gray-500 dark:text-gray-400"
                                  : ""
                              }`}
                              style={{
                                color: isSelected
                                  ? `${getContrastingTextColor(
                                      category.color
                                    )}80`
                                  : undefined,
                              }}
                            >
                              {category.songCount}
                            </span>
                          )}
                        </Badge>
                      );
                    })}

                    {sortedCategories.length > CATEGORY_DISPLAY_LIMIT && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs px-3 py-1"
                        onClick={() => setIsCategoryModalOpen(true)}
                      >
                        전체 보기 (+
                        {sortedCategories.length - CATEGORY_DISPLAY_LIMIT})
                      </Button>
                    )}
                  </>
                );
              })()}
            </>
          )}
        </div>
      </div>

      <div id="channel-filter-artist" className="flex flex-col gap-2 w-full">
        <div className="flex flex-row gap-2 items-center">
          <label
            htmlFor="search"
            className="text-sm font-semibold text-gray-900 dark:text-gray-100"
          >
            가수
          </label>
          {userPermission?.manageContent && (
            <Link
              href={`/channel/${username}/manage/artists`}
              className="cursor-pointer hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-gray-800 rounded-md p-1"
            >
              <PencilIcon size={12} />
            </Link>
          )}
        </div>

        <div className="flex flex-wrap gap-2 channel-filter-badges">
          {isArtistsLoading ? (
            <SkeletonBadgeList count={6} badgeVariant="badge-md" />
          ) : artistsError ? (
            <InlineError
              message="아티스트를 불러올 수 없습니다."
              size="sm"
              className="w-full"
              onRetry={refetchArtists}
            />
          ) : (
            <>
              {(() => {
                const sortedArtists =
                  artists
                    ?.slice()
                    .filter((artist) => (artist.songCount || 0) > 0)
                    .sort((a, b) => (b.songCount || 0) - (a.songCount || 0)) ||
                  [];

                const displayArtists = sortedArtists.slice(
                  0,
                  ARTIST_DISPLAY_LIMIT
                );

                return (
                  <>
                    {displayArtists.map((artist) => {
                      const isSelected = selectedArtistIdSet.has(
                        artist.id.toString()
                      );
                      return (
                        <Badge
                          key={artist.id}
                          variant={isSelected ? "default" : "outline"}
                          className={`px-3 py-1 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-1 transition-colors ${
                            isSelected
                              ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200"
                              : ""
                          }`}
                          onClick={() =>
                            handleArtistClick(artist.id.toString())
                          }
                        >
                          {artist.name}
                          {artist.songCount !== undefined && (
                            <span
                              className={`text-xs ml-1 ${
                                isSelected
                                  ? "text-white/80 dark:text-gray-900/80"
                                  : "text-gray-500 dark:text-gray-400"
                              }`}
                            >
                              {artist.songCount}
                            </span>
                          )}
                        </Badge>
                      );
                    })}

                    {sortedArtists.length > ARTIST_DISPLAY_LIMIT && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs px-3 py-1"
                        onClick={() => setIsArtistModalOpen(true)}
                      >
                        전체 보기 (+
                        {sortedArtists.length - ARTIST_DISPLAY_LIMIT})
                      </Button>
                    )}
                  </>
                );
              })()}
            </>
          )}
        </div>
      </div>

      {/* 아티스트 전체보기 모달 */}
      <ArtistSelectDialog
        open={isArtistModalOpen}
        onOpenChange={setIsArtistModalOpen}
        artists={artists}
        selectedArtistIds={artistIds}
        onSelect={setArtists}
      />

      {/* 카테고리 전체보기 모달 */}
      <CategorySelectDialog
        open={isCategoryModalOpen}
        onOpenChange={setIsCategoryModalOpen}
        categories={categories}
        selectedCategoryIds={categoryIds}
        onSelect={setCategories}
      />

      <div
        id="channel-filter-difficulty"
        className="flex flex-col gap-2 w-full"
      >
        <div className="flex flex-row gap-2 items-center">
          <label
            htmlFor="search"
            className="text-sm font-semibold text-gray-900 dark:text-gray-100"
          >
            {ratingLabel}
          </label>
        </div>

        <RadioGroup
          onValueChange={handleDifficultyChange}
          value={ratingValue || "all"}
          className="flex flex-col gap-2"
        >
          <div className="flex flex-row gap-2 items-center">
            <RadioGroupItem value="all" id="star-all" />
            <Label htmlFor="star-all">전체</Label>
          </div>

          {[1, 2, 3, 4, 5].map((star) => (
            <div key={star} className="flex flex-row gap-2 items-center">
              <RadioGroupItem value={star.toString()} id={`star-${star}`} />
              <Label htmlFor={`star-${star}`} className="gap-0.5">
                <StarList star={star} size={14} tone={ratingTone} />
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>
    </section>
  );
}
