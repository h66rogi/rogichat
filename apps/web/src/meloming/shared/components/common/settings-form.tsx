"use client";

import * as React from "react";
import { createContext, useContext, useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/meloming/shared/components/ui/card";
import { Input } from "@/meloming/shared/components/ui/input";
import { cn } from "@/meloming/shared/lib/utils";

const CompactSettingsContext = createContext(false);

export function useCompactSettings() {
  return useContext(CompactSettingsContext);
}

export function SettingsCompactProvider({
  compact,
  children,
}: {
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <CompactSettingsContext.Provider value={Boolean(compact)}>
      {children}
    </CompactSettingsContext.Provider>
  );
}

export function SettingsPanel({
  children,
  className,
  contentClassName,
}: {
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={cn("py-0", className)}>
      <CardContent className={cn("px-4", contentClassName)}>
        {children}
      </CardContent>
    </Card>
  );
}

export function SettingsRow({
  title,
  description,
  children,
  className,
  labelClassName,
  controlClassName,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  labelClassName?: string;
  controlClassName?: string;
}) {
  const compact = useCompactSettings();

  return (
    <div
      className={cn(
        "grid grid-cols-1 border-b last:border-b-0",
        compact
          ? "gap-1.5 py-2.5 sm:grid-cols-[140px_1fr] sm:gap-3"
          : "gap-2 py-4 sm:grid-cols-[200px_1fr] sm:gap-6",
        className,
      )}
    >
      <div className={labelClassName}>
        <div className={cn("font-medium", compact && "text-sm")}>{title}</div>
        {description && (
          <p
            className={cn(
              "mt-0.5 text-muted-foreground",
              compact ? "text-[11px] leading-tight" : "text-xs",
            )}
          >
            {description}
          </p>
        )}
      </div>
      <div className={controlClassName}>{children}</div>
    </div>
  );
}

export function SettingsSectionHeader({
  title,
  id,
  className,
}: {
  title: string;
  id?: string;
  className?: string;
}) {
  const compact = useCompactSettings();

  return (
    <div
      id={id}
      className={cn(
        "-mx-4 border-b bg-muted/30 px-4 font-medium",
        id && "scroll-mt-20",
        compact ? "py-2 text-xs" : "py-3 text-sm",
        className,
      )}
    >
      {title}
    </div>
  );
}

export function SettingsNumberInput({
  value,
  min,
  max,
  onCommit,
  disabled,
  className,
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [local, setLocal] = useState(String(value));

  useEffect(() => {
    setLocal(String(value));
  }, [value]);

  const commit = () => {
    const parsed = Number(local);
    if (Number.isNaN(parsed)) {
      setLocal(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, Math.floor(parsed)));
    setLocal(String(clamped));
    if (clamped !== value) {
      onCommit(clamped);
    }
  };

  return (
    <Input
      type="number"
      min={min}
      max={max}
      value={local}
      disabled={disabled}
      onChange={(event) => setLocal(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
      className={className}
    />
  );
}

export function SettingsInlineNote({
  children,
  icon: Icon,
  className,
}: {
  children: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 py-3 text-xs text-muted-foreground",
        className,
      )}
    >
      {Icon && <Icon className="mt-0.5 size-3.5 shrink-0" />}
      <div className="min-w-0 flex-1 leading-relaxed">{children}</div>
    </div>
  );
}
