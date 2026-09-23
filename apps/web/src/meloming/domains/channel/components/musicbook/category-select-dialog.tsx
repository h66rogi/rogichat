import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/meloming/shared/components/ui/dialog";
import { Input } from "@/meloming/shared/components/ui/input";
import { Badge } from "@/meloming/shared/components/ui/badge";
import { Button } from "@/meloming/shared/components/ui/button";
import { getChoseong, canBeChoseong } from "es-hangul";
import { getContrastingTextColor } from "@/meloming/shared/lib/utils";
import type { Category } from "@/meloming/domains/channel/types/category";
import { sortCategories } from "@/meloming/domains/channel/utils/category-sort";

interface CategorySelectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Category[] | undefined;
  selectedCategoryIds: readonly string[];
  onSelect: (categoryIds: readonly string[]) => void;
}

export function CategorySelectDialog({
  open,
  onOpenChange,
  categories,
  selectedCategoryIds,
  onSelect,
}: CategorySelectDialogProps) {
  const [categoryModalQuery, setCategoryModalQuery] = useState("");
  const selectedIdSet = new Set(selectedCategoryIds);

  const handleClose = (shouldOpen: boolean) => {
    onOpenChange(shouldOpen);
    if (!shouldOpen) {
      setCategoryModalQuery("");
    }
  };

  const handleCategoryClick = (categoryId: string) => {
    const next = new Set(selectedCategoryIds);
    if (next.has(categoryId)) {
      next.delete(categoryId);
    } else {
      next.add(categoryId);
    }
    onSelect(Array.from(next).sort((a, b) => Number(a) - Number(b)));
  };

  const handleSelectAll = () => {
    onSelect([]);
    setCategoryModalQuery("");
    handleClose(false);
  };

  const sortedCategories = sortCategories(
    categories?.filter((category) => (category.songCount || 0) > 0) || []
  );

  // Filter with modal query (supports choseong)
  const q = categoryModalQuery.trim();
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

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="max-w-2xl max-h-[80vh] overflow-y-auto"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>카테고리 전체 보기</DialogTitle>
        </DialogHeader>
        <div className="mb-2">
          <Input
            placeholder="카테고리 검색 (초성 가능)"
            value={categoryModalQuery}
            onChange={(e) => setCategoryModalQuery(e.target.value)}
            autoFocus={false}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {/* 선택 초기화 버튼 */}
          <Button
            variant={selectedCategoryIds.length > 0 ? "outline" : "default"}
            size="sm"
            className="h-8 text-xs px-3 py-1"
            onClick={handleSelectAll}
          >
            선택 초기화
          </Button>

          {filteredCategories.map((category) => {
            const isSelected = selectedIdSet.has(category.id.toString());
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
                onClick={() => handleCategoryClick(category.id.toString())}
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
                {category.songCount !== undefined && (
                  <span
                    className={`text-xs ml-1 ${
                      !isSelected ? "text-gray-500 dark:text-gray-400" : ""
                    }`}
                    style={{
                      color: isSelected
                        ? `${getContrastingTextColor(category.color)}80`
                        : undefined,
                    }}
                  >
                    {category.songCount}
                  </span>
                )}
              </Badge>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
