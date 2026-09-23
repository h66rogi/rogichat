"use client";

import { Medal } from "lucide-react";
import { cn } from "@/meloming/shared/lib/utils";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/meloming/shared/components/ui/tooltip";

type FounderBadgeVariant = "default" | "small" | "icon-only" | "inline";

interface FounderBadgeProps {
  variant?: FounderBadgeVariant;
  className?: string;
}

/**
 * 멜로밍 1주년 설립자 뱃지 (첫 100명 한정).
 */
export function FounderBadge({
  variant = "default",
  className,
}: FounderBadgeProps) {
  if (variant === "icon-only") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "flex items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-pink-500 text-white shadow-sm cursor-default",
              "w-5 h-5",
              className
            )}
          >
            <Medal className="w-3 h-3" />
          </div>
        </TooltipTrigger>
        <TooltipContent>멜로밍 1주년 설립자</TooltipContent>
      </Tooltip>
    );
  }

  if (variant === "small") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold cursor-default",
              "bg-gradient-to-r from-rose-500 to-pink-500 text-white shadow-sm",
              className
            )}
          >
            <Medal className="w-2.5 h-2.5" />
            <span>설립자</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>멜로밍 1주년 설립자</TooltipContent>
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
              "bg-gradient-to-r from-rose-500 to-pink-500 text-white",
              className
            )}
          >
            <Medal className="w-2 h-2" />
            설립자
          </span>
        </TooltipTrigger>
        <TooltipContent>멜로밍 1주년 설립자</TooltipContent>
      </Tooltip>
    );
  }

  // default
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold cursor-default",
            "bg-gradient-to-r from-rose-500 to-pink-500 text-white shadow-md",
            className
          )}
        >
          <Medal className="w-3.5 h-3.5" />
          <span>설립자</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>멜로밍 1주년 설립자</TooltipContent>
    </Tooltip>
  );
}
