"use client";

import {
  Code2,
  Sparkles,
  Undo2,
  Redo2,
  History,
  RotateCcw,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/meloming/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/meloming/shared/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/meloming/shared/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/meloming/shared/components/ui/tooltip";
import { cn } from "@/meloming/shared/lib/utils";
import type { CssHistoryEntry } from "@/meloming/domains/channel/hooks/use-css-history";

interface DecorationToolbarProps {
  // 에디터 모드
  editorMode: "ai" | "code";
  onEditorModeChange: (mode: "ai" | "code") => void;

  // 히스토리
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  cssHistory: CssHistoryEntry[];
  cssHistoryIndex: number;
  onGoToHistory: (index: number) => void;

  // 코드 모드 액션
  hasUnsavedChanges: boolean;
  onReset: () => void;
  onDelete?: () => void;
  showDelete?: boolean;

  // 테마 초기화
  onClearTheme?: () => void;
  isClearingTheme?: boolean;
}

export function DecorationToolbar({
  editorMode,
  onEditorModeChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  cssHistory,
  cssHistoryIndex,
  onGoToHistory,
  hasUnsavedChanges,
  onReset,
  onDelete,
  showDelete,
  onClearTheme,
  isClearingTheme,
}: DecorationToolbarProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center justify-between py-3">
        <div className="flex items-center gap-3">
          {/* Undo/Redo 버튼 */}
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onUndo}
                  disabled={!canUndo}
                  className="size-8"
                >
                  <Undo2 className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>실행 취소 (⌘Z)</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onRedo}
                  disabled={!canRedo}
                  className="size-8"
                >
                  <Redo2 className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>다시 실행 (⌘⇧Z)</p>
              </TooltipContent>
            </Tooltip>

            {/* 히스토리 드롭다운 */}
            {cssHistory.length > 1 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 ml-0.5">
                    <History className="size-3.5" />
                    <span className="text-xs tabular-nums">
                      {cssHistoryIndex + 1}/{cssHistory.length}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                    변경 이력
                  </div>
                  <DropdownMenuSeparator />
                  <div className="max-h-64 overflow-y-auto">
                    {cssHistory.map((entry, index) => (
                      <DropdownMenuItem
                        key={entry.timestamp}
                        onClick={() => onGoToHistory(index)}
                        className={cn(
                          "flex items-center justify-between gap-2",
                          index === cssHistoryIndex && "bg-accent"
                        )}
                      >
                        <span className="truncate text-sm">{entry.label}</span>
                        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                          {new Date(entry.timestamp).toLocaleTimeString("ko-KR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {/* 테마 초기화 버튼 */}
          {onClearTheme && (
            <AlertDialog>
              <Tooltip>
                <TooltipTrigger asChild>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-amber-600"
                      disabled={isClearingTheme}
                    >
                      <RefreshCw className={cn("size-4", isClearingTheme && "animate-spin")} />
                    </Button>
                  </AlertDialogTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>테마 초기화</p>
                </TooltipContent>
              </Tooltip>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>테마를 초기화하시겠습니까?</AlertDialogTitle>
                  <AlertDialogDescription>
                    저장된 CSS 테마가 삭제되고 에디터가 비워집니다.
                    <br />
                    <span className="text-destructive font-medium">이 작업은 되돌릴 수 없습니다.</span>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>취소</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={onClearTheme}
                    className="bg-amber-600 text-white hover:bg-amber-700"
                  >
                    초기화
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        {/* 우측 영역 */}
        <div className="flex items-center gap-3">
          {/* 액션 버튼 */}
          <div className="flex items-center gap-1">
          {hasUnsavedChanges && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onReset}
                  className="size-8"
                >
                  <RotateCcw className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>변경사항 초기화</p>
              </TooltipContent>
            </Tooltip>
          )}

          {showDelete && onDelete && (
            <AlertDialog>
              <Tooltip>
                <TooltipTrigger asChild>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </AlertDialogTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>CSS 삭제</p>
                </TooltipContent>
              </Tooltip>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>CSS를 삭제하시겠습니까?</AlertDialogTitle>
                  <AlertDialogDescription>
                    저장된 CSS가 완전히 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>취소</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={onDelete}
                    className="bg-destructive text-white hover:bg-destructive/90"
                  >
                    삭제
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          </div>

          {/* 구분선 */}
          <div className="h-5 w-px bg-border" />

          {/* 모드 전환 세그먼트 컨트롤 */}
          <div className="inline-flex items-center p-1 bg-muted rounded-lg">
            <button
              type="button"
              onClick={() => onEditorModeChange("ai")}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-all",
                editorMode === "ai"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Sparkles className="size-4" />
              <span>AI</span>
            </button>
            <button
              type="button"
              onClick={() => onEditorModeChange("code")}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-all",
                editorMode === "code"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Code2 className="size-4" />
              <span>코드</span>
            </button>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
