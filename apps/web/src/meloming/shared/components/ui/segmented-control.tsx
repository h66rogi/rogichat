"use client";

import * as React from "react";
import { cn } from "@/meloming/shared/lib/utils";

export type SegmentedControlOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
};

type SegmentedControlProps<T extends string> = {
  value: T;
  options: SegmentedControlOption<T>[];
  onValueChange: (value: T) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  /** 각 옵션 버튼의 최소 너비 (기본 none → 콘텐츠 기반) */
  minOptionWidth?: number | string;
  className?: string;
  "aria-label"?: string;
};

const SIZE_STYLES = {
  sm: {
    container: "p-0.5",
    option: "px-3 py-1 text-xs",
  },
  md: {
    container: "p-1",
    option: "px-4 py-1.5 text-sm",
  },
} as const;

export function SegmentedControl<T extends string>({
  value,
  options,
  onValueChange,
  disabled = false,
  size = "md",
  minOptionWidth,
  className,
  "aria-label": ariaLabel,
}: SegmentedControlProps<T>) {
  const sizeStyles = SIZE_STYLES[size];

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center rounded-full bg-muted",
        sizeStyles.container,
        disabled && "opacity-60",
        className,
      )}
    >
      {options.map((option) => {
        const isSelected = option.value === value;
        const isOptionDisabled = disabled || option.disabled;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={isOptionDisabled}
            onClick={() => !isOptionDisabled && onValueChange(option.value)}
            style={minOptionWidth ? { minWidth: minOptionWidth } : undefined}
            className={cn(
              "flex-1 whitespace-nowrap rounded-full font-medium transition-colors",
              "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              "disabled:cursor-not-allowed",
              sizeStyles.option,
              isSelected
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
