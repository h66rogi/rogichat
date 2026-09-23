"use client";

import { useEffect, useState } from "react";
import { useEditorContext } from "../state/editor-context";

/**
 * Photoshop 색상 패널 + 스와치.
 *
 * - 활성 전경색 표시 (도구 팔레트 swatch 와 동기화)
 * - HEX 입력
 * - HSB 슬라이더 (간단 버전)
 * - 최근 사용 색상 (localStorage 영속화 — 채널/사용자 전역)
 */
const RECENT_KEY = "photoshop-editor:recent-colors";
const RECENT_LIMIT = 16;

const DEFAULT_SWATCHES = [
  "#000000",
  "#ffffff",
  "#e74c3c",
  "#e67e22",
  "#f1c40f",
  "#2ecc71",
  "#3498db",
  "#9b59b6",
  "#34495e",
  "#7f8c8d",
];

export function ColorPanel() {
  const ctx = useEditorContext();
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(RECENT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (
          Array.isArray(parsed) &&
          parsed.every((x) => typeof x === "string")
        ) {
          setRecent(parsed);
        }
      }
    } catch {
      // localStorage 접근 실패 시 무시
    }
  }, []);

  const pushRecent = (color: string) => {
    setRecent((prev) => {
      const filtered = prev.filter((c) => c.toLowerCase() !== color.toLowerCase());
      const next = [color, ...filtered].slice(0, RECENT_LIMIT);
      try {
        window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        // ignore quota errors
      }
      return next;
    });
  };

  const apply = (color: string) => {
    ctx.setForegroundColor(color);
    pushRecent(color);
    // 단일 텍스트 레이어가 선택된 경우 자동으로 폰트 색상 적용 (Photoshop UX).
    const slot = ctx.singleSelectedSlot;
    if (slot && slot.type === "text") {
      ctx.patchSlot(
        slot.id,
        { font: { ...slot.font, color } } as Parameters<typeof ctx.patchSlot>[1],
        { label: "색상" },
      );
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="ps-panel-header">색상</div>
      <div className="ps-panel-body p-2 space-y-3">
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={ctx.foregroundColor}
            onChange={(e) => apply(e.target.value)}
            className="w-12 h-12 cursor-pointer border border-[var(--ps-border)] rounded-sm"
            aria-label="전경색"
          />
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-[var(--ps-text-muted)] w-6">HEX</span>
              <input
                type="text"
                value={ctx.foregroundColor}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)) {
                    apply(v);
                  } else {
                    ctx.setForegroundColor(v);
                  }
                }}
                className="ps-num-input flex-1 font-mono"
                style={{ width: "auto" }}
              />
            </div>
          </div>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--ps-text-muted)" }}>
            기본 스와치
          </p>
          <div className="grid grid-cols-8 gap-1">
            {DEFAULT_SWATCHES.map((c) => (
              <SwatchCell key={c} color={c} onClick={() => apply(c)} />
            ))}
          </div>
        </div>

        {recent.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--ps-text-muted)" }}>
              최근 사용
            </p>
            <div className="grid grid-cols-8 gap-1">
              {recent.map((c) => (
                <SwatchCell key={c} color={c} onClick={() => apply(c)} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SwatchCell({ color, onClick }: { color: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="aspect-square rounded-sm cursor-pointer border"
      style={{
        background: color,
        borderColor: "var(--ps-border-strong)",
      }}
      aria-label={color}
      title={color}
    />
  );
}
