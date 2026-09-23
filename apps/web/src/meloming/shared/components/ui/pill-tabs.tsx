"use client";

import { Button } from "@/meloming/shared/components/ui/button";
import { Badge } from "@/meloming/shared/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/meloming/shared/components/ui/tooltip";
import { cn } from "@/meloming/shared/lib/utils";
import type { LucideIcon } from "lucide-react";

export type PillTabItem<T extends string> = {
  id: T;
  label: string;
  icon?: LucideIcon;
  disabled?: boolean;
  /** disabled 상태일 때 표시할 툴팁 */
  disabledTooltip?: string;
  /** 탭에 표시할 배지 (숫자 또는 문자열) */
  badge?: number | string;
};

type PillTabsProps<T extends string> = {
  tabs: PillTabItem<T>[];
  activeTab: T;
  onTabChange: (tab: T) => void;
  className?: string;
};

export function PillTabs<T extends string>({
  tabs,
  activeTab,
  onTabChange,
  className,
}: PillTabsProps<T>) {
  return (
    <div className={cn("flex gap-2", className)}>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isDisabled = tab.disabled ?? false;
        const showTooltip = isDisabled && tab.disabledTooltip;

        const button = (
          <Button
            key={tab.id}
            type="button"
            variant={activeTab === tab.id ? "default" : "outline"}
            className={cn(
              "rounded-full transition-none",
              activeTab === tab.id && "pointer-events-none"
            )}
            onClick={() => !isDisabled && onTabChange(tab.id)}
            disabled={isDisabled}
          >
            {Icon && <Icon className="size-4" />}
            {tab.label}
            {tab.badge !== undefined && tab.badge !== 0 && (
              <Badge
                variant={activeTab === tab.id ? "secondary" : "default"}
                className="ml-1 px-1.5 py-0 text-[10px] min-w-[18px] h-[18px] justify-center"
              >
                {tab.badge}
              </Badge>
            )}
          </Button>
        );

        if (showTooltip) {
          return (
            <Tooltip key={tab.id}>
              <TooltipTrigger asChild>
                <span className="inline-flex">{button}</span>
              </TooltipTrigger>
              <TooltipContent>
                <p>{tab.disabledTooltip}</p>
              </TooltipContent>
            </Tooltip>
          );
        }

        return button;
      })}
    </div>
  );
}
