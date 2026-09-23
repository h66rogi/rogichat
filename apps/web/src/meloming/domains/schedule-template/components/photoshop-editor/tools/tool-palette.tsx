"use client";

import { cn } from "@/meloming/shared/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/meloming/shared/components/ui/tooltip";
import { useEditorContext } from "../state/editor-context";
import { TOOLS } from "./tool-types";

/**
 * Photoshop 좌측 도구 팔레트 (52px wide vertical strip).
 *
 * 단일 컬럼 — Photoshop 의 더블 컬럼은 우리 도구 수가 적어서 불필요.
 * Tooltip 으로 도구 이름 + 단축키 노출.
 */
export function ToolPalette() {
  const ctx = useEditorContext();

  return (
    <TooltipProvider delayDuration={400}>
      <div
        data-photoshop-tool-palette
        className="flex flex-col items-center py-1 gap-0.5 shrink-0 border-r"
        style={{
          width: "var(--ps-tool-bar-width)",
          background: "var(--ps-bg-elevated)",
          borderColor: "var(--ps-divider)",
        }}
      >
        {TOOLS.map((tool) => {
          const Icon = tool.icon;
          const isActive = ctx.activeTool === tool.id;
          return (
            <Tooltip key={tool.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "ps-tool-button",
                    isActive && "is-active",
                  )}
                  onClick={() => !tool.disabled && ctx.setActiveTool(tool.id)}
                  disabled={tool.disabled}
                  aria-label={`${tool.label} (${tool.shortcut})`}
                  aria-pressed={isActive}
                  data-tool-id={tool.id}
                >
                  <Icon className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                className="bg-[var(--ps-bg-elevated)] border border-[var(--ps-border)] text-[var(--ps-text)] text-[11px]"
              >
                {tool.label}
                <span className="ml-2 text-[var(--ps-text-muted)]">
                  ({tool.shortcut})
                </span>
              </TooltipContent>
            </Tooltip>
          );
        })}

        <div
          className="my-1 w-6 h-px"
          style={{ background: "var(--ps-border)" }}
        />

        {/* Foreground 색상 표시 (스포이드와 페어) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="size-7 rounded-sm border-2"
              style={{
                background: ctx.foregroundColor,
                borderColor: "var(--ps-border-strong)",
              }}
              onClick={() => {
                // Foreground 색상 ↔ White toggle (Photoshop X)
                const next =
                  ctx.foregroundColor.toLowerCase() === "#ffffff"
                    ? "#000000"
                    : "#ffffff";
                ctx.setForegroundColor(next);
              }}
              aria-label="전경색"
            />
          </TooltipTrigger>
          <TooltipContent
            side="right"
            className="bg-[var(--ps-bg-elevated)] border border-[var(--ps-border)] text-[var(--ps-text)] text-[11px]"
          >
            전경색 — {ctx.foregroundColor}
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
