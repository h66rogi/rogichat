"use client";

import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/meloming/shared/components/ui/popover";

interface ColorSwatchInputProps {
  value: string;
  onChange: (color: string) => void;
  disabled?: boolean;
}

/**
 * 작은 색상 swatch + hex 입력. 클릭 시 native color picker popover.
 */
export function ColorSwatchInput({
  value,
  onChange,
  disabled,
}: ColorSwatchInputProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value);

  return (
    <span className="inline-flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className="size-5 rounded-sm border-2 cursor-pointer disabled:cursor-not-allowed"
            style={{
              background: value || "transparent",
              borderColor: "var(--ps-border-strong)",
            }}
            aria-label="색상 선택"
          />
        </PopoverTrigger>
        <PopoverContent
          className="p-3 w-[220px] bg-[var(--ps-bg-elevated)] border-[var(--ps-border)] text-[var(--ps-text)]"
          side="bottom"
        >
          <input
            type="color"
            value={isValidHex(value) ? value : "#000000"}
            onChange={(e) => onChange(e.target.value)}
            className="w-full h-10 cursor-pointer"
          />
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[10px] text-[var(--ps-text-muted)]">HEX</span>
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => {
                if (isValidHex(text)) {
                  onChange(text);
                } else {
                  setText(value);
                }
              }}
              className="ps-num-input flex-1 font-mono"
            />
          </div>
        </PopoverContent>
      </Popover>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          if (isValidHex(v)) onChange(v);
        }}
        disabled={disabled}
        className="ps-num-input font-mono"
        style={{ width: 76 }}
      />
    </span>
  );
}

function isValidHex(s: string): boolean {
  return /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s);
}
