"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/meloming/shared/lib/utils";

export interface ContextMenuItem {
  label: string;
  onClick(): void | Promise<void>;
  disabled?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  /** 컨테이너 viewport (메뉴가 잘리지 않도록 좌표 보정용). */
  containerWidth: number;
  containerHeight: number;
  items: ContextMenuItem[];
  onClose(): void;
}

export function ContextMenu({
  x,
  y,
  containerWidth,
  containerHeight,
  items,
  onClose,
}: ContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });
  const [focusIndex, setFocusIndex] = useState(0);

  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const left = Math.min(x, Math.max(0, containerWidth - rect.width - 4));
    const top = Math.min(y, Math.max(0, containerHeight - rect.height - 4));
    setPos({ left, top });
  }, [x, y, containerWidth, containerHeight]);

  useEffect(() => {
    itemRefs.current[focusIndex]?.focus();
  }, [focusIndex]);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIndex((i) => (i + 1) % items.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIndex((i) => (i - 1 + items.length) % items.length);
      } else if (e.key === "Home") {
        e.preventDefault();
        setFocusIndex(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setFocusIndex(items.length - 1);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [items.length, onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-orientation="vertical"
      onMouseDown={(e) => e.stopPropagation()}
      className={cn(
        "absolute z-40 min-w-[180px] overflow-hidden rounded-md border border-white/10 bg-black/90 text-white shadow-xl backdrop-blur-md"
      )}
      style={{ left: pos.left, top: pos.top }}
    >
      {items.map((item, i) => (
        <button
          key={`${item.label}-${i}`}
          ref={(el) => {
            itemRefs.current[i] = el;
          }}
          type="button"
          role="menuitem"
          onClick={async () => {
            await item.onClick();
            onClose();
          }}
          disabled={item.disabled}
          className="block w-full px-3 py-2 text-left text-xs hover:bg-white/10 focus:bg-white/10 focus:outline-none disabled:opacity-40"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
