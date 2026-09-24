'use client';

import { cn } from '@/meloming/shared/lib/utils';

interface ThemeFilterProps {
  allTags: string[];
  selectedTags: string[];
  onChange: (tags: string[]) => void;
}

/**
 * 태그 기반 필터 칩.
 *
 * - "전체" 버튼: 모든 선택 태그 해제
 * - 태그 칩: 클릭 시 토글 (다중 선택)
 */
export function ThemeFilter({
  allTags,
  selectedTags,
  onChange,
}: ThemeFilterProps) {
  const toggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      onChange(selectedTags.filter((t) => t !== tag));
    } else {
      onChange([...selectedTags, tag]);
    }
  };

  const isAllSelected = selectedTags.length === 0;

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="테마 태그 필터">
      <button
        type="button"
        onClick={() => onChange([])}
        aria-pressed={isAllSelected}
        className={cn(
          'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          isAllSelected
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border bg-background text-foreground hover:border-primary/50 hover:bg-accent'
        )}
      >
        전체
      </button>

      {allTags.map((tag) => {
        const isSelected = selectedTags.includes(tag);
        return (
          <button
            key={tag}
            type="button"
            onClick={() => toggleTag(tag)}
            aria-pressed={isSelected}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              isSelected
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background text-foreground hover:border-primary/50 hover:bg-accent'
            )}
          >
            {tag}
          </button>
        );
      })}
    </div>
  );
}
