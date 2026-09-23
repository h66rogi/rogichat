'use client';

import { useMemo, useState } from 'react';
import { AlertCircle, ChevronDown } from 'lucide-react';
import { Skeleton } from '@/meloming/shared/components/ui/skeleton';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/meloming/shared/components/ui/collapsible';
import { cn } from '@/meloming/shared/lib/utils';
import { useThemeCatalog } from '@/meloming/domains/channel/hooks/use-overlay-theme';
import { ThemeCard } from './ThemeCard';

interface ThemeGridProps {
  selectedThemeId: string | null;
  onSelect: (themeId: string) => void;
  /** Collapsible 기본 펼침 여부. 기본 true */
  defaultOpen?: boolean;
}

/**
 * 통합 오버레이 테마를 둘러보고 선택할 수 있는 메인 그리드.
 *
 * - 백엔드가 반환하는 전체 테마 카탈로그를 그대로 표시
 * - 썸네일 + 테마 제목만 노출 (태그 필터/검색/설명 제거)
 * - 반응형 그리드: 모바일 2열, 태블릿 3열, 데스크톱 4열
 * - Collapsible: 접기/펼치기 가능
 */
export function ThemeGrid({ selectedThemeId, onSelect, defaultOpen = true }: ThemeGridProps) {
  const { data, isLoading, isError, error } = useThemeCatalog();
  const themes = useMemo(() => data?.themes ?? [], [data?.themes]);
  const [open, setOpen] = useState(defaultOpen);

  const selectedThemeName = useMemo(
    () => themes.find((t) => t.id === selectedThemeId)?.name,
    [themes, selectedThemeId],
  );

  if (isLoading) return <ThemeGridSkeleton />;
  if (isError) return <ThemeGridError message={resolveErrorMessage(error)} />;
  if (themes.length === 0) return <ThemeGridEmpty />;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border bg-muted/30 px-4 py-2.5 text-left hover:bg-muted/50 transition-colors">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            테마 선택
          </span>
          {!open && selectedThemeName && (
            <span className="text-xs text-muted-foreground">
              — {selectedThemeName}
            </span>
          )}
        </div>
        <ChevronDown
          className={cn(
            'size-4 text-muted-foreground transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {themes.map((theme) => (
            <ThemeCard
              key={theme.id}
              theme={theme}
              selected={selectedThemeId === theme.id}
              onClick={() => onSelect(theme.id)}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ThemeGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 8 }).map((_, idx) => (
        <div
          key={idx}
          className="overflow-hidden rounded-xl border border-border bg-card"
        >
          <Skeleton className="aspect-video w-full rounded-none" />
          <div className="p-3">
            <Skeleton className="h-4 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ThemeGridError({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-destructive/40 bg-destructive/5 px-4 py-12 text-center">
      <AlertCircle className="size-6 text-destructive" />
      <p className="text-sm font-medium text-destructive">
        테마 목록을 불러오지 못했습니다.
      </p>
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

function ThemeGridEmpty() {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-12 text-center">
      <p className="text-sm font-medium">등록된 테마가 없습니다.</p>
    </div>
  );
}

function resolveErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return '잠시 후 다시 시도해 주세요.';
}
