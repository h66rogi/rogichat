"use client";

import {
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
import { Textarea } from "@/meloming/shared/components/ui/textarea";
import type {
  TextSlot,
  TextSlotFont,
} from "@/meloming/domains/schedule-template/types/template-spec";
import { useEditorContext } from "../state/editor-context";
import { NumericInput } from "./numeric-input";
import { ColorSwatchInput } from "./color-swatch-input";
import { Row, Section } from "./properties-panel";

const WEIGHT_OPTIONS: TextSlotFont["weight"][] = [400, 500, 600, 700, 800];
const WEIGHT_LABELS: Record<TextSlotFont["weight"], string> = {
  400: "Regular",
  500: "Medium",
  600: "SemiBold",
  700: "Bold",
  800: "ExtraBold",
};

/**
 * Character 패널 — Photoshop "문자" 패널.
 *
 * 텍스트 슬롯 단일 선택 시에만 의미. 다른 타입은 비어있음 표시.
 */
export function CharacterPanel() {
  const ctx = useEditorContext();
  const slot = ctx.singleSelectedSlot;
  const text = slot && slot.type === "text" ? (slot as TextSlot) : null;

  return (
    <div className="flex flex-col h-full">
      <div className="ps-panel-header">문자</div>
      <div className="ps-panel-body p-2">
        {!text ? (
          <p className="text-[11px] text-[var(--ps-text-muted)] p-2">
            텍스트 레이어를 선택하면 표시됩니다.
          </p>
        ) : (
          <CharacterFields text={text} />
        )}
      </div>
    </div>
  );
}

function CharacterFields({ text }: { text: TextSlot }) {
  const ctx = useEditorContext();
  const updateFont = (patch: Partial<TextSlotFont>, label?: string) => {
    ctx.patchSlot(
      text.id,
      { font: { ...text.font, ...patch } } as Partial<TextSlot>,
      { coalesceKey: `font:${text.id}:${Object.keys(patch).join(",")}`, label },
    );
  };

  return (
    <div className="space-y-3">
      <Section title="텍스트">
        <Textarea
          value={text.literal ?? ""}
          onChange={(e) =>
            ctx.patchSlot(
              text.id,
              { literal: e.target.value } as Partial<TextSlot>,
              { coalesceKey: `literal:${text.id}`, label: "텍스트 입력" },
            )
          }
          placeholder={
            text.binding
              ? "binding 결과가 비면 표시됩니다"
              : "표시할 고정 텍스트"
          }
          className="text-[11px] min-h-[60px] bg-[var(--ps-bg-input)] border-[var(--ps-border)]"
        />
      </Section>

      <Section title="폰트">
        <Row>
          <Select value={text.font.family} disabled>
            <SelectTrigger className="ps-select flex-1 h-6">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Pretendard">Pretendard</SelectItem>
            </SelectContent>
          </Select>
        </Row>
        <Row>
          <Select
            value={String(text.font.weight)}
            onValueChange={(v) =>
              updateFont({ weight: Number(v) as TextSlotFont["weight"] }, "굵기")
            }
          >
            <SelectTrigger className="ps-select flex-1 h-6">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[var(--ps-bg-elevated)] border-[var(--ps-border)] text-[var(--ps-text)]">
              {WEIGHT_OPTIONS.map((w) => (
                <SelectItem key={w} value={String(w)}>
                  {WEIGHT_LABELS[w]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      </Section>

      <Section title="크기 & 간격">
        <Row>
          <NumericInput
            label="T"
            value={text.font.size}
            min={1}
            step={1}
            suffix="px"
            title="폰트 크기"
            onChange={(v) => updateFont({ size: Math.max(1, Math.round(v)) }, "크기")}
          />
          <NumericInput
            label="L"
            value={text.font.lineHeight ?? 1.2}
            min={0.5}
            step={0.1}
            title="줄 간격 (배수)"
            onChange={(v) => updateFont({ lineHeight: v }, "줄 간격")}
          />
        </Row>
        <Row>
          <NumericInput
            label="V/A"
            value={text.font.letterSpacing ?? 0}
            step={0.5}
            suffix="px"
            title="자간"
            onChange={(v) => updateFont({ letterSpacing: v }, "자간")}
          />
          <NumericInput
            label="↕"
            value={text.font.verticalScale ?? 1}
            min={0.1}
            step={0.05}
            title="세로 배율"
            onChange={(v) => updateFont({ verticalScale: v }, "세로 배율")}
          />
        </Row>
        <Row>
          <NumericInput
            label="#"
            value={text.font.maxLines ?? 1}
            min={1}
            step={1}
            title="최대 줄 수 (넘치면 …)"
            onChange={(v) => updateFont({ maxLines: Math.max(1, Math.round(v)) }, "최대 줄 수")}
          />
        </Row>
      </Section>

      <Section title="색상 & 스타일">
        <Row>
          <ColorSwatchInput
            value={text.font.color}
            onChange={(c) => updateFont({ color: c }, "색상")}
          />
        </Row>
        <Row>
          <ToggleButton
            active={text.font.italic === true}
            Icon={Italic}
            label="기울임"
            onClick={() => updateFont({ italic: !(text.font.italic === true) }, "기울임")}
          />
          <ToggleButton
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
          <ToggleButton
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
        </Row>
      </Section>
    </div>
  );
}

interface ToggleButtonProps {
  active: boolean;
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}

function ToggleButton({ active, Icon, label, onClick }: ToggleButtonProps) {
  return (
    <button
      type="button"
      className={`ps-tool-button ${active ? "is-active" : ""}`}
      style={{ width: 24, height: 22 }}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
    >
      <Icon className="size-3" />
    </button>
  );
}
