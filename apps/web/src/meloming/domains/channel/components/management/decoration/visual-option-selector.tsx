"use client";

import { cn } from "@/meloming/shared/lib/utils";
import { Check } from "lucide-react";

interface VisualOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  preview: React.ReactNode;
}

interface VisualOptionSelectorProps<T extends string> {
  options: VisualOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}

export function VisualOptionSelector<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: VisualOptionSelectorProps<T>) {
  return (
    <div className="flex flex-wrap gap-3">
      {options.map((option) => {
        const isSelected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative flex flex-col items-center gap-2 rounded-lg border-2 p-3 transition-all text-left cursor-pointer",
              "hover:border-primary/50 hover:bg-accent/30",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              isSelected
                ? "border-primary bg-primary/5"
                : "border-muted"
            )}
          >
            {isSelected && (
              <div className="absolute top-1.5 right-1.5 size-5 rounded-full bg-primary flex items-center justify-center">
                <Check className="size-3 text-primary-foreground" />
              </div>
            )}
            <div className="w-32 h-20 rounded-md overflow-hidden bg-muted/50 flex items-center justify-center">
              {option.preview}
            </div>
            <div className="w-32 text-center">
              <div className="text-sm font-medium">{option.label}</div>
              {option.description && (
                <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                  {option.description}
                </p>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// --- 미리보기 일러스트 컴포넌트 ---

export function LayoutDefaultPreview() {
  return (
    <div className="w-full h-full p-2 flex flex-col items-center">
      <div className="w-16 h-2 bg-muted-foreground/20 rounded mb-1" />
      <div className="w-16 h-full bg-muted-foreground/15 rounded flex flex-col gap-0.5 p-1">
        <div className="w-full h-1 bg-muted-foreground/30 rounded" />
        <div className="w-3/4 h-1 bg-muted-foreground/20 rounded" />
        <div className="w-full h-1 bg-muted-foreground/30 rounded" />
      </div>
    </div>
  );
}

export function LayoutWidePreview() {
  return (
    <div className="w-full h-full p-2 flex flex-col items-center">
      <div className="w-full h-2 bg-muted-foreground/20 rounded mb-1" />
      <div className="w-full h-full bg-muted-foreground/15 rounded flex flex-col gap-0.5 p-1">
        <div className="w-full h-1 bg-muted-foreground/30 rounded" />
        <div className="w-3/4 h-1 bg-muted-foreground/20 rounded" />
        <div className="w-full h-1 bg-muted-foreground/30 rounded" />
      </div>
    </div>
  );
}

export function HeaderWidePreview() {
  return (
    <div className="w-full h-full flex flex-col">
      <div className="w-full h-6 bg-blue-400/30 rounded-t" />
      <div className="flex items-center gap-1 px-2 py-1">
        <div className="size-3 rounded-full bg-muted-foreground/30 -mt-1" />
        <div className="w-8 h-1.5 bg-muted-foreground/20 rounded" />
      </div>
      <div className="flex-1 mx-2 bg-muted-foreground/10 rounded" />
    </div>
  );
}

export function HeaderSeparatedPreview() {
  return (
    <div className="w-full h-full flex flex-col p-1.5 gap-1">
      <div className="w-full h-6 bg-blue-400/30 rounded-lg" />
      <div className="flex items-center gap-1 px-1">
        <div className="size-3 rounded-full bg-muted-foreground/30" />
        <div className="w-8 h-1.5 bg-muted-foreground/20 rounded" />
      </div>
      <div className="flex-1 bg-muted-foreground/10 rounded" />
    </div>
  );
}

export function ColorModeSystemPreview() {
  return (
    <div className="w-full h-full flex">
      <div className="w-1/2 h-full bg-white rounded-l flex flex-col gap-0.5 p-1.5">
        <div className="w-full h-1 bg-gray-300 rounded" />
        <div className="w-3/4 h-1 bg-gray-200 rounded" />
      </div>
      <div className="w-1/2 h-full bg-gray-800 rounded-r flex flex-col gap-0.5 p-1.5">
        <div className="w-full h-1 bg-gray-600 rounded" />
        <div className="w-3/4 h-1 bg-gray-700 rounded" />
      </div>
    </div>
  );
}

export function ColorModeLightPreview() {
  return (
    <div className="w-full h-full bg-white rounded flex flex-col gap-1 p-2">
      <div className="w-full h-1.5 bg-gray-200 rounded" />
      <div className="w-3/4 h-1.5 bg-gray-300 rounded" />
      <div className="w-full h-1.5 bg-gray-200 rounded" />
      <div className="w-1/2 h-1.5 bg-gray-300 rounded" />
    </div>
  );
}

export function ColorModeDarkPreview() {
  return (
    <div className="w-full h-full bg-gray-900 rounded flex flex-col gap-1 p-2">
      <div className="w-full h-1.5 bg-gray-700 rounded" />
      <div className="w-3/4 h-1.5 bg-gray-600 rounded" />
      <div className="w-full h-1.5 bg-gray-700 rounded" />
      <div className="w-1/2 h-1.5 bg-gray-600 rounded" />
    </div>
  );
}

/** 신규 레이아웃: 좌측 메뉴 사이드바 + 콘텐츠 */
export function LayoutNewPreview() {
  return (
    <div className="w-full h-full p-1.5 flex gap-1">
      <div className="w-5 h-full bg-muted-foreground/25 rounded flex flex-col gap-0.5 p-0.5">
        <div className="w-full h-1 bg-muted-foreground/40 rounded" />
        <div className="w-full h-1 bg-muted-foreground/30 rounded" />
        <div className="w-full h-1 bg-muted-foreground/30 rounded" />
      </div>
      <div className="flex-1 h-full bg-muted-foreground/15 rounded flex flex-col gap-0.5 p-1">
        <div className="w-full h-1 bg-muted-foreground/30 rounded" />
        <div className="w-3/4 h-1 bg-muted-foreground/20 rounded" />
      </div>
    </div>
  );
}
