'use client';

import { useState } from 'react';
import {
  ChevronDown,
  RotateCcw,
  Music,
  ListMusic,
  FileText,
} from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/meloming/shared/components/ui/collapsible';
import { Button } from '@/meloming/shared/components/ui/button';
import { Label } from '@/meloming/shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/meloming/shared/components/ui/select';
import { cn } from '@/meloming/shared/lib/utils';
import type {
  ThemeCatalogEntry,
  WidgetType,
} from '@/meloming/domains/channel/apis/overlay-theme';

const USE_BASE_VALUE = '__base__';

interface WidgetMeta {
  type: WidgetType;
  name: string;
  description: string;
  Icon: typeof Music;
}

const WIDGETS: WidgetMeta[] = [
  {
    type: 'now-playing',
    name: '재생 중 위젯',
    description: '현재 재생 중인 곡을 표시',
    Icon: Music,
  },
  {
    type: 'queue',
    name: '대기열 위젯',
    description: '신청곡 대기열을 표시',
    Icon: ListMusic,
  },
  {
    type: 'setlist',
    name: '셋리스트 위젯',
    description: '대기열 + 재생 기록을 한 화면에',
    Icon: FileText,
  },
];

interface WidgetOverridePanelProps {
  /** The channel's unified theme (baseline for all widgets unless overridden) */
  baseThemeId: string;
  /** Current override map. null values mean "no override" */
  overrides: Record<string, string | null>;
  /** Callback when an override changes. Pass null to remove an override. */
  onOverrideChange: (widgetType: WidgetType, themeId: string | null) => void;
  /** Theme catalog for dropdown options */
  catalog: ThemeCatalogEntry[];
  /** Theme name lookup (catalog search) */
  getThemeName: (themeId: string) => string;
}

/**
 * 위젯별로 통합 테마를 개별 오버라이드할 수 있는 패널.
 *
 * - 채널의 기본 테마(`baseThemeId`)를 모든 위젯이 공유하지만, 위젯별로
 *   다른 테마를 적용하고 싶을 때 사용한다.
 * - 각 위젯은 "통합 테마 사용"을 선택하면 오버라이드가 제거된다(`null`).
 * - 모든 오버라이드를 한 번에 초기화하는 "전체 초기화" 버튼을 제공한다.
 *
 * Collapsible로 감싸 기본적으로는 접혀 있고, 사용자가 필요할 때만 펼쳐서
 * 고급 설정을 노출한다.
 */
export function WidgetOverridePanel({
  baseThemeId,
  overrides,
  onOverrideChange,
  catalog,
  getThemeName,
}: WidgetOverridePanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  const overrideCount = WIDGETS.reduce((count, widget) => {
    const value = overrides[widget.type];
    return value && value !== baseThemeId ? count + 1 : count;
  }, 0);

  const sortedCatalog = [...catalog].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const handleResetAll = () => {
    WIDGETS.forEach((widget) => {
      if (overrides[widget.type] != null) {
        onOverrideChange(widget.type, null);
      }
    });
  };

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className="rounded-xl border border-border bg-card"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left transition-colors',
            'hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
          )}
          aria-expanded={isOpen}
        >
          <div className="flex flex-col gap-0.5">
            <h4 className="text-sm font-semibold">위젯별 개별 설정</h4>
            <p className="text-xs text-muted-foreground">
              {overrideCount > 0
                ? `${overrideCount}개 위젯이 통합 테마와 다르게 설정되어 있습니다.`
                : '특정 위젯에만 다른 테마를 적용할 수 있습니다.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {overrideCount > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                {overrideCount}
              </span>
            )}
            <ChevronDown
              className={cn(
                'size-4 text-muted-foreground transition-transform',
                isOpen && 'rotate-180'
              )}
            />
          </div>
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="space-y-4 border-t border-border px-4 py-4">
          <p className="text-xs text-muted-foreground">
            기본 통합 테마:{' '}
            <span className="font-medium text-foreground">
              {getThemeName(baseThemeId)}
            </span>
          </p>

          <div className="space-y-3">
            {WIDGETS.map((widget) => {
              const overrideValue = overrides[widget.type] ?? null;
              const effectiveThemeId = overrideValue ?? baseThemeId;
              const isOverridden =
                overrideValue !== null && overrideValue !== baseThemeId;
              const selectValue = overrideValue ?? USE_BASE_VALUE;
              const selectId = `widget-override-${widget.type}`;
              const Icon = widget.Icon;

              return (
                <div
                  key={widget.type}
                  className={cn(
                    'flex flex-col gap-2 rounded-lg border p-3 transition-colors sm:flex-row sm:items-center sm:gap-4',
                    isOverridden
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-border bg-background'
                  )}
                >
                  <div className="flex flex-1 items-center gap-3">
                    <div
                      className={cn(
                        'flex size-9 shrink-0 items-center justify-center rounded-md',
                        isOverridden
                          ? 'bg-primary/10 text-primary'
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      <Icon className="size-4" />
                    </div>
                    <div className="flex min-w-0 flex-col">
                      <Label
                        htmlFor={selectId}
                        className="text-sm font-medium"
                      >
                        {widget.name}
                      </Label>
                      <span className="truncate text-xs text-muted-foreground">
                        현재: {getThemeName(effectiveThemeId)}
                        {isOverridden && (
                          <span className="ml-1 text-primary">(오버라이드)</span>
                        )}
                      </span>
                    </div>
                  </div>

                  <Select
                    value={selectValue}
                    onValueChange={(value) => {
                      if (value === USE_BASE_VALUE) {
                        onOverrideChange(widget.type, null);
                      } else {
                        onOverrideChange(widget.type, value);
                      }
                    }}
                  >
                    <SelectTrigger
                      id={selectId}
                      className="w-full sm:w-56"
                      aria-label={`${widget.name} 테마 선택`}
                    >
                      <SelectValue placeholder="테마 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={USE_BASE_VALUE}>
                        통합 테마 사용 ({getThemeName(baseThemeId)})
                      </SelectItem>
                      {sortedCatalog.map((theme) => (
                        <SelectItem key={theme.id} value={theme.id}>
                          {theme.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleResetAll}
              disabled={overrideCount === 0}
              className="gap-1.5"
            >
              <RotateCcw className="size-3.5" />
              전체 초기화
            </Button>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
