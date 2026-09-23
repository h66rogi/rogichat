"use client";

import { useEditorContext } from "../state/editor-context";
import type { ImageSlot } from "@/meloming/domains/schedule-template/types/template-spec";
import { NumericInput } from "../panels/numeric-input";
import { ColorSwatchInput } from "../panels/color-swatch-input";

/**
 * 사각형 도형 도구 옵션바.
 *
 * 우리 데이터 모델에는 "도형" 타입이 없어서, fallbackUrl 비어있고 borderRadius 가 있는
 * ImageSlot 으로 placeholder. (Phase 8 에서 ShapeSlot 추가 가능.)
 */
export function ShapeOptions() {
  const ctx = useEditorContext();
  const slot = ctx.singleSelectedSlot;
  const image = slot && slot.type === "image" ? (slot as ImageSlot) : null;

  if (!image) {
    return (
      <span className="text-[11px] text-[var(--ps-text-muted)]">
        사각형 슬롯을 선택하거나 캔버스에 추가
      </span>
    );
  }

  return (
    <>
      <span className="ps-label">배경 (fallback)</span>
      <ColorSwatchInput
        value={image.fallbackUrl ?? ""}
        onChange={(_c) => {
          // ImageSlot 은 색이 아닌 URL 만 받음 — 도형 색상은 V2 로 ShapeSlot 추가 시 지원.
        }}
        disabled
      />
      <span className="text-[11px] text-[var(--ps-text-muted)]">
        (도형 채움색은 곧 지원 예정 — 현재는 fallbackUrl 만)
      </span>

      <span className="ps-vsep" />

      <NumericInput
        label="R"
        value={image.borderRadius ?? 0}
        min={0}
        step={1}
        suffix="px"
        title="모서리 반경"
        onChange={(v) =>
          ctx.patchSlot(
            image.id,
            { borderRadius: Math.max(0, Math.round(v)) } as Partial<ImageSlot>,
            { coalesceKey: `radius:${image.id}`, label: "모서리 반경" },
          )
        }
      />

      <span className="ps-vsep" />

      <span className="ps-label">맞춤</span>
      <select
        className="ps-select"
        value={image.fit}
        onChange={(e) =>
          ctx.patchSlot(
            image.id,
            { fit: e.target.value as ImageSlot["fit"] },
            { label: "이미지 맞춤" },
          )
        }
      >
        <option value="cover">Cover</option>
        <option value="contain">Contain</option>
        <option value="fill">Fill</option>
      </select>
    </>
  );
}
