"use client";

import { useState, useEffect, useRef } from "react";
import { Search, X, Trash, Pencil } from "lucide-react";
import { Input } from "@/meloming/shared/components/ui/input";
import { Button } from "@/meloming/shared/components/ui/button";
import { Badge } from "@/meloming/shared/components/ui/badge";
import { debounce } from "es-toolkit";
import type { Category } from "@/meloming/domains/channel/types/category";
import type { Artist } from "@/meloming/domains/channel/types/artist";
import { getContrastingTextColor } from "@/meloming/shared/lib/utils";
import StarList from "@/meloming/domains/channel/components/musicbook/star-list";

const SEARCH_DEBOUNCE_DELAY_MS = 300;

interface SongsTableToolbarProps {
  searchQuery: string;
  setSearchQuery: (query: string | undefined) => void;
  selectedCount: number;
  onBulkDelete: () => void;
  onBulkEdit: () => void;
  isBulkDeleting?: boolean;
  isBulkEditing?: boolean;
  // 필터 관련
  categories?: Category[];
  artists?: Artist[];
  selectedCategoryId: string | null;
  selectedArtistId: string | null;
  selectedDifficulty: string | null;
  onCategoryChange: (id: string | undefined) => void;
  onArtistChange: (id: string | undefined) => void;
  onDifficultyChange: (difficulty: string | undefined) => void;
  onSearchFocus?: () => void;
  onSearchLocalChange?: (query: string) => void;
  onSearchClearIntent?: () => void;
}

export function SongsTableToolbar({
  searchQuery,
  setSearchQuery,
  selectedCount,
  onBulkDelete,
  onBulkEdit,
  isBulkDeleting = false,
  isBulkEditing = false,
  categories,
  artists,
  selectedCategoryId,
  selectedArtistId,
  selectedDifficulty,
  onCategoryChange,
  onArtistChange,
  onDifficultyChange,
  onSearchFocus,
  onSearchLocalChange,
  onSearchClearIntent,
}: SongsTableToolbarProps) {
  // 선택된 필터 정보
  const selectedCategory = categories?.find(
    (c) => c.id.toString() === selectedCategoryId
  );
  const selectedArtist = artists?.find(
    (a) => a.id.toString() === selectedArtistId
  );

  const hasActiveFilters =
    selectedCategoryId || selectedArtistId || selectedDifficulty;
  // 로컬 검색 상태
  const [localSearchQuery, setLocalSearchQuery] = useState(searchQuery);
  const setSearchQueryRef = useRef(setSearchQuery);

  // searchQuery가 외부에서 변경될 때 동기화
  useEffect(() => {
    setLocalSearchQuery(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    setSearchQueryRef.current = setSearchQuery;
  }, [setSearchQuery]);

  // debounced 함수
  const [debouncedSetSearchQuery] = useState(() =>
    debounce((query: string) => {
      setSearchQueryRef.current(query || undefined);
    }, SEARCH_DEBOUNCE_DELAY_MS)
  );

  useEffect(() => {
    debouncedSetSearchQuery(localSearchQuery);
    return () => {
      debouncedSetSearchQuery.cancel();
    };
  }, [localSearchQuery, debouncedSetSearchQuery]);

  const handleSearchClear = () => {
    onSearchClearIntent?.();
    setLocalSearchQuery("");
    setSearchQuery(undefined);
  };

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
      {/* 좌측: 활성 필터 + 선택된 항목 */}
      <div className="flex items-center gap-2 flex-wrap order-2 sm:order-1">
        {/* 활성 필터 표시 */}
        {hasActiveFilters && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {selectedCategory && (
              <Badge
                variant="secondary"
                className="pl-2 pr-1 py-1 gap-1 cursor-pointer hover:bg-secondary/80"
                style={{
                  backgroundColor: selectedCategory.color,
                  color: getContrastingTextColor(selectedCategory.color),
                }}
                onClick={() => onCategoryChange(undefined)}
              >
                {selectedCategory.name}
                <X className="w-3 h-3" />
              </Badge>
            )}
            {selectedArtist && (
              <Badge
                variant="secondary"
                className="pl-2 pr-1 py-1 gap-1 cursor-pointer hover:bg-secondary/80"
                onClick={() => onArtistChange(undefined)}
              >
                {selectedArtist.name}
                <X className="w-3 h-3" />
              </Badge>
            )}
            {selectedDifficulty && (
              <Badge
                variant="secondary"
                className="pl-2 pr-1 py-1 gap-1 cursor-pointer hover:bg-secondary/80"
                onClick={() => onDifficultyChange(undefined)}
              >
                <StarList star={Number(selectedDifficulty)} size={10} />
                <X className="w-3 h-3" />
              </Badge>
            )}
          </div>
        )}

        {/* 선택된 항목 수 및 일괄 수정/삭제 */}
        {selectedCount > 0 && (
          <>
            {hasActiveFilters && (
              <div className="w-px h-4 bg-border mx-1" />
            )}
            <span className="text-sm text-muted-foreground">
              {selectedCount}개 선택됨
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={onBulkEdit}
              disabled={isBulkEditing}
            >
              <Pencil className="w-4 h-4 sm:mr-1" />
              <span className="hidden sm:inline">일괄 수정</span>
            </Button>
            <Button
              variant="destructive-outline"
              size="sm"
              onClick={onBulkDelete}
              disabled={isBulkDeleting}
            >
              <Trash className="w-4 h-4 sm:mr-1" />
              <span className="hidden sm:inline">일괄 삭제</span>
            </Button>
          </>
        )}
      </div>

      {/* 우측: 검색 */}
      <div className="relative w-full sm:w-64 order-1 sm:order-2">
        <Input
          placeholder="제목 또는 가수명 검색"
          className="pr-8"
          value={localSearchQuery}
          onFocus={onSearchFocus}
          onChange={(e) => {
            const nextQuery = e.target.value;
            onSearchLocalChange?.(nextQuery);
            setLocalSearchQuery(nextQuery);
          }}
        />
        {localSearchQuery ? (
          <X
            size={16}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground cursor-pointer hover:text-foreground"
            onClick={handleSearchClear}
          />
        ) : (
          <Search
            size={16}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
        )}
      </div>
    </div>
  );
}
