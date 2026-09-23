"use client";

import { Award } from "lucide-react";
import { cn } from "@/meloming/shared/lib/utils";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/meloming/shared/components/ui/tooltip";

type AmbassadorBadgeVariant = "default" | "small" | "icon-only" | "inline";

interface AmbassadorBadgeProps {
  variant?: AmbassadorBadgeVariant;
  className?: string;
}

/**
 * 앰배서더 인증 뱃지
 * - default: 기본 크기 (아이콘 + 텍스트)
 * - small: 작은 크기 (아이콘 + 텍스트)
 * - icon-only: 아이콘만
 * - inline: 인라인 텍스트용 (닉네임 옆)
 */
export function AmbassadorBadge({
  variant = "default",
  className,
}: AmbassadorBadgeProps) {
  if (variant === "icon-only") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "flex items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-sm cursor-default",
              "w-5 h-5",
              className
            )}
          >
            <Award className="w-3 h-3" />
          </div>
        </TooltipTrigger>
        <TooltipContent>멜로밍 앰배서더</TooltipContent>
      </Tooltip>
    );
  }

  if (variant === "small") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold cursor-default",
              "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-sm",
              className
            )}
          >
            <Award className="w-2.5 h-2.5" />
            <span>앰배서더</span>
          </div>
        </TooltipTrigger>
        <TooltipContent>멜로밍 앰배서더</TooltipContent>
      </Tooltip>
    );
  }

  if (variant === "inline") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-bold align-middle cursor-default",
              "bg-gradient-to-r from-amber-500 to-orange-500 text-white",
              className
            )}
          >
            <Award className="w-2 h-2" />
            앰배서더
          </span>
        </TooltipTrigger>
        <TooltipContent>멜로밍 앰배서더</TooltipContent>
      </Tooltip>
    );
  }

  // default
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold cursor-default",
            "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md",
            className
          )}
        >
          <Award className="w-3.5 h-3.5" />
          <span>앰배서더</span>
        </div>
      </TooltipTrigger>
      <TooltipContent>멜로밍 앰배서더</TooltipContent>
    </Tooltip>
  );
}
