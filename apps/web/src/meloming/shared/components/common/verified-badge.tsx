"use client";

import { Check } from "lucide-react";
import { cn } from "@/meloming/shared/lib/utils";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/meloming/shared/components/ui/tooltip";

type VerifiedBadgeVariant = "default" | "small" | "icon-only" | "inline";

interface VerifiedBadgeProps {
  variant?: VerifiedBadgeVariant;
  className?: string;
}

/**
 * 채널 인증 뱃지 (플랫폼 소유권 검증 완료)
 * 초록색 체크 아이콘으로 표시
 */
export function VerifiedBadge({
  variant = "default",
  className,
}: VerifiedBadgeProps) {
  // 모든 variant에서 동일한 초록색 체크 아이콘 표시
  const sizeClass =
    variant === "small" || variant === "inline"
      ? "w-4 h-4"
      : variant === "icon-only"
        ? "w-5 h-5"
        : "w-5 h-5";

  const iconSize =
    variant === "small" || variant === "inline"
      ? "w-2.5 h-2.5"
      : variant === "icon-only"
        ? "w-3 h-3"
        : "w-3 h-3";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "flex items-center justify-center rounded-full bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-sm cursor-default",
            sizeClass,
            className
          )}
        >
          <Check className={iconSize} strokeWidth={3} />
        </div>
      </TooltipTrigger>
      <TooltipContent>인증된 채널</TooltipContent>
    </Tooltip>
  );
}
