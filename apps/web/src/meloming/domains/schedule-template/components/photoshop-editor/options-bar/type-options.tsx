"use client";

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Italic,
  Strikethrough,
  Underline,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/meloming/shared/components/ui/select";
import { useEditorContext } from "../state/editor-context";
import type {
  TextSlot,
  TextSlotFont,
} from "@/meloming/domains/schedule-template/types/template-spec";
import { NumericInput } from "../panels/numeric-input";
import { ColorSwatchInput } from "../panels/color-swatch-input";

const WEIGHT_OPTIONS: TextSlotFont["weight"][] = [400, 500, 600, 700, 800];
const WEIGHT_LABELS: Record<TextSlotFont["weight"], string> = {
  400: "Regular",
  500: "Medium",
  600: "SemiBold",
  700: "Bold",
  800: "ExtraBold",
};

/**
 * Type 도구 옵션바 — 단일 텍스트 슬롯이 선택되어 있을 때만 활성.
 *
 * 변경 사항은 단일 텍스트 슬롯의 font 에 patch.
 */
export function TypeOptions() {
  const ctx = useEditorContext();
  const slot = ctx.singleSelectedSlot;
  const text = slot && slot.type === "text" ? (slot as TextSlot) : null;

  if (!text) {
    return (
      <span className="text-[11px] text-[var(--ps-text-muted)]">
        텍스트 레이어를 선택하거나 캔버스를 클릭해 추가
      </span>
    );
  }

  const updateFont = (patch: Partial<TextSlotFont>, label?: string) => {
    ctx.patchSlot(
      text.id,
      { font: { ...text.font, ...patch } } as Partial<TextSlot>,
      { coalesceKey: `font:${text.id}:${Object.keys(patch).join(",")}`, label },
    );
  };

  return (
    <>
      <span className="ps-label">폰트</span>
      <Select value={text.font.family} disabled>
        <SelectTrigger className="ps-select w-[120px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="Pretendard">Pretendard</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={String(text.font.weight)}
        onValueChange={(v) => updateFont({ weight: Number(v) as TextSlotFont["weight"] }, "굵기 변경")}
      >
        <SelectTrigger className="ps-select w-[100px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {WEIGHT_OPTIONS.map((w) => (
            <SelectItem key={w} value={String(w)}>
              {WEIGHT_LABELS[w]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <NumericInput
        label="T"
        value={text.font.size}
        min={1}
        step={1}
        suffix="px"
        onChange={(v) => updateFont({ size: Math.max(1, Math.round(v)) }, "폰트 크기")}
      />

      <NumericInput
        label="V/A"
        value={text.font.letterSpacing ?? 0}
        step={0.5}
        suffix="px"
        title="자간"
        onChange={(v) => updateFont({ letterSpacing: v }, "자간")}
      />

      <NumericInput
        label="L"
        value={text.font.lineHeight ?? 1.2}
        min={0.5}
        step={0.1}
        title="줄 간격 배수"
        onChange={(v) => updateFont({ lineHeight: v }, "줄 간격")}
      />

      <span className="ps-vsep" />

      <ColorSwatchInput
        value={text.font.color}
        onChange={(c) => updateFont({ color: c }, "색상")}
      />

      <span className="ps-vsep" />

      <AlignButton
        active={text.font.align === "left"}
        Icon={AlignLeft}
        label="왼쪽"
        onClick={() => updateFont({ align: "left" }, "정렬: 왼쪽")}
      />
      <AlignButton
        active={text.font.align === "center"}
        Icon={AlignCenter}
        label="가운데"
        onClick={() => updateFont({ align: "center" }, "정렬: 가운데")}
      />
      <AlignButton
        active={text.font.align === "right"}
        Icon={AlignRight}
        label="오른쪽"
        onClick={() => updateFont({ align: "right" }, "정렬: 오른쪽")}
      />

      <span className="ps-vsep" />

      <AlignButton
        active={text.font.italic === true}
        Icon={Italic}
        label="기울임"
        onClick={() => updateFont({ italic: !(text.font.italic === true) }, "기울임")}
      />
      <AlignButton
        active={text.font.decoration === "underline"}
        Icon={Underline}
        label="밑줄"
        onClick={() =>
          updateFont(
            {
              decoration:
                text.font.decoration === "underline" ? "none" : "underline",
            },
            "밑줄",
          )
        }
      />
      <AlignButton
        active={text.font.decoration === "line-through"}
        Icon={Strikethrough}
        label="취소선"
        onClick={() =>
          updateFont(
            {
              decoration:
                text.font.decoration === "line-through" ? "none" : "line-through",
            },
            "취소선",
          )
        }
      />
    </>
  );
}

interface AlignButtonProps {
  active: boolean;
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}

function AlignButton({ active, Icon, label, onClick }: AlignButtonProps) {
  return (
    <button
      type="button"
      className={`ps-tool-button ${active ? "is-active" : ""}`}
      style={{ width: 26, height: 26 }}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
    >
      <Icon className="size-3.5" />
    </button>
  );
}
