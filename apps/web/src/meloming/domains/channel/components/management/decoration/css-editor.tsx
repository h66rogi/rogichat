"use client";

import { useCallback, useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { css } from "@codemirror/lang-css";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { useTheme } from "next-themes";
import { getCssSize, formatCssSize, MAX_CSS_SIZE_BYTES } from "./css-utils";
import { cn } from "@/meloming/shared/lib/utils";

interface CssEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  height?: string;
}

/**
 * CodeMirror 기반 CSS 에디터 컴포넌트
 * - 구문 강조
 * - 다크/라이트 테마 자동 전환
 * - CSS 크기 표시
 */
export function CssEditor({
  value,
  onChange,
  disabled = false,
  className,
  height = "400px",
}: CssEditorProps) {
  const { resolvedTheme } = useTheme();
  const isDarkMode = resolvedTheme === "dark";

  // 에디터 기본 테마 확장
  const customTheme = useMemo(
    () =>
      EditorView.theme({
        "&": {
          fontSize: "14px",
          fontFamily:
            'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        },
        ".cm-content": {
          padding: "12px 0",
        },
        ".cm-line": {
          padding: "0 16px",
        },
        ".cm-gutters": {
          borderRight: "none",
          backgroundColor: "transparent",
        },
        ".cm-activeLineGutter": {
          backgroundColor: isDarkMode
            ? "rgba(255, 255, 255, 0.05)"
            : "rgba(0, 0, 0, 0.03)",
        },
        ".cm-activeLine": {
          backgroundColor: isDarkMode
            ? "rgba(255, 255, 255, 0.03)"
            : "rgba(0, 0, 0, 0.02)",
        },
        "&.cm-focused": {
          outline: "none",
        },
      }),
    [isDarkMode]
  );

  const handleChange = useCallback(
    (val: string) => {
      onChange(val);
    },
    [onChange]
  );

  // CSS 크기 계산
  const cssSize = getCssSize(value);
  const isOverLimit = cssSize > MAX_CSS_SIZE_BYTES;

  // height가 100%인 경우 flex-1로 처리, 아니면 고정 높이
  const isFlexHeight = height === "100%";

  return (
    <div className={cn("flex flex-col", isFlexHeight && "h-full", className)}>
      <div
        className={cn(
          "border rounded-t-lg overflow-hidden",
          isFlexHeight ? "flex-1 min-h-0" : "",
          disabled && "opacity-50 pointer-events-none",
          isOverLimit && "border-destructive"
        )}
      >
        <CodeMirror
          value={value}
          height={isFlexHeight ? "100%" : height}
          extensions={[css(), customTheme]}
          theme={isDarkMode ? oneDark : undefined}
          onChange={handleChange}
          readOnly={disabled}
          placeholder="CSS 코드를 입력하세요..."
          className={cn(
            isFlexHeight &&
              "h-full [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto"
          )}
          basicSetup={{
            lineNumbers: true,
            highlightActiveLineGutter: true,
            highlightActiveLine: true,
            foldGutter: true,
            dropCursor: true,
            indentOnInput: true,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: true,
            highlightSelectionMatches: true,
          }}
        />
      </div>
      {/* 하단 상태바 */}
      <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground border-x border-b rounded-b-lg bg-muted/30 shrink-0">
        <span>{value.split("\n").length} 줄</span>
        <span className={cn(isOverLimit && "text-destructive font-medium")}>
          {formatCssSize(cssSize)} / {formatCssSize(MAX_CSS_SIZE_BYTES)}
          {isOverLimit && " (크기 초과)"}
        </span>
      </div>
    </div>
  );
}
