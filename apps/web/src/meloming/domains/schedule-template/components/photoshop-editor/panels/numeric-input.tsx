"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";

interface NumericInputProps {
  /** 좌측 라벨 (T, X, W 같은 1-2글자). */
  label?: string;
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** 우측 단위 표시 (px, deg, % 등). */
  suffix?: string;
  title?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * Photoshop 스타일 작은 숫자 입력 컴포넌트.
 *
 * 특징:
 *  - 라벨이 좌측에 작게 표시 (T, X, W 등)
 *  - 입력값을 commit 하기 전에는 onChange 호출 안 함 (blur / Enter 시점에 commit)
 *  - 라벨/입력 부분을 좌우 드래그하면 값 증감 (Photoshop "scrubbing slider")
 *  - ↑/↓ 키로 step 만큼 증감, Shift + ↑/↓ 는 10배.
 */
export function NumericInput({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  title,
  className = "",
  disabled,
}: NumericInputProps) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(formatValue(value));
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 외부 value 변화 — 입력 중이 아니면 동기화. 입력 중에는 사용자 keystroke 보존.
  useEffect(() => {
    if (!focused) {
      setText(formatValue(value));
    }
  }, [value, focused]);

  const clamp = useCallback(
    (n: number) => {
      let r = n;
      if (typeof min === "number" && r < min) r = min;
      if (typeof max === "number" && r > max) r = max;
      return r;
    },
    [min, max],
  );

  const commit = useCallback(
    (raw: string) => {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        setText(formatValue(value));
        return;
      }
      const clamped = clamp(parsed);
      onChange(clamped);
      setText(formatValue(clamped));
    },
    [clamp, onChange, value],
  );

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit(text);
      (e.target as HTMLInputElement).blur();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setText(formatValue(value));
      (e.target as HTMLInputElement).blur();
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const direction = e.key === "ArrowUp" ? 1 : -1;
      const multiplier = e.shiftKey ? 10 : 1;
      const next = clamp(value + direction * step * multiplier);
      onChange(next);
    }
  };

  const handleBlur = () => {
    setFocused(false);
    commit(text);
  };

  // Scrubbing — 라벨에서 마우스 down → 좌우 드래그로 값 증감.
  const handleLabelPointerDown = (e: PointerEvent<HTMLSpanElement>) => {
    if (disabled) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startValue = value;
    let lastNotified = startValue;

    const onMove = (m: globalThis.PointerEvent) => {
      const dx = m.clientX - startX;
      const stepPerPx = step;
      // shift = 10x, alt = 0.1x
      const multiplier = m.shiftKey ? 10 : m.altKey ? 0.1 : 1;
      const next = clamp(
        Math.round((startValue + dx * stepPerPx * multiplier) / step) * step,
      );
      if (next !== lastNotified) {
        lastNotified = next;
        onChange(next);
      }
    };
    const onUp = (m: globalThis.PointerEvent) => {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <span
      className={`inline-flex items-center gap-0 rounded-sm border ${className}`}
      style={{
        height: 22,
        background: "var(--ps-bg-input)",
        borderColor: "var(--ps-border)",
      }}
      title={title}
    >
      {label !== undefined && (
        <span
          onPointerDown={handleLabelPointerDown}
          className="px-1.5 text-[10px] cursor-ew-resize select-none"
          style={{ color: "var(--ps-text-muted)" }}
          role="presentation"
        >
          {label}
        </span>
      )}
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        value={text}
        onChange={handleChange}
        onFocus={(e) => {
          setFocused(true);
          // 자동 select for quick replace (Photoshop UX)
          e.target.select();
        }}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        className="bg-transparent border-0 outline-none w-12 text-[11px] text-center tabular-nums px-1"
        style={{ color: "var(--ps-text)" }}
      />
      {suffix !== undefined && (
        <span className="pr-1 text-[10px]" style={{ color: "var(--ps-text-muted)" }}>
          {suffix}
        </span>
      )}
    </span>
  );
}

function formatValue(n: number): string {
  if (!Number.isFinite(n)) return "0";
  // 정수면 그대로, 소수면 최대 2자리.
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/\.?0+$/, "");
}
