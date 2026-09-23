"use client";

import {
  FlipHorizontal2,
  FlipVertical2,
  RotateCcw,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/meloming/shared/components/ui/select";
import { Input } from "@/meloming/shared/components/ui/input";
import type {
  ImageSlot,
  TemplateSlot,
} from "@/meloming/domains/schedule-template/types/template-spec";
import { useEditorContext } from "../state/editor-context";
import { NumericInput } from "./numeric-input";
import { ScheduleTemplateBindingField } from "../../editor/schedule-template-binding-field";

/**
 * Properties 패널 — 선택된 슬롯의 변환 속성 + 공통 속성 + 타입별 속성.
 *
 * Photoshop "속성" 패널에 해당. 변환(Transform), Appearance (블렌드는 Layers 패널에 분리),
 * 타입별 속성 (이미지 fit, 텍스트 binding 등) 을 모은다.
 */
export function PropertiesPanel() {
  const ctx = useEditorContext();
  const slot = ctx.singleSelectedSlot;

  if (!slot) {
    if (ctx.selectedSlotIds.length > 1) {
      return <MultiSelectionInfo count={ctx.selectedSlotIds.length} />;
    }
    return (
      <div className="flex flex-col h-full">
        <div className="ps-panel-header">속성</div>
        <div className="ps-panel-body p-3 text-[11px] text-[var(--ps-text-muted)]">
          레이어를 선택하면 속성이 표시됩니다.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="ps-panel-header">속성</div>
      <div className="ps-panel-body p-2 space-y-3">
        <TransformSection slot={slot} />
        {slot.type === "image" && <ImageSection slot={slot as ImageSlot} />}
        <BindingSection slot={slot} />
      </div>
    </div>
  );
}

function MultiSelectionInfo({ count }: { count: number }) {
  return (
    <div className="flex flex-col h-full">
      <div className="ps-panel-header">속성</div>
      <div className="ps-panel-body p-3 text-[11px]" style={{ color: "var(--ps-text)" }}>
        {count}개 레이어가 선택됨
        <p className="mt-2 text-[var(--ps-text-muted)]">
          공통 속성은 Layers 패널에서 일괄 변경할 수 있습니다.
        </p>
      </div>
    </div>
  );
}

function TransformSection({ slot }: { slot: TemplateSlot }) {
  const ctx = useEditorContext();

  const updateNum = (key: "x" | "y" | "w" | "h" | "rotation", value: number) => {
    const v =
      key === "w" || key === "h"
        ? Math.max(1, Math.round(value))
        : key === "rotation"
          ? value
          : Math.round(value);
    ctx.patchSlot(
      slot.id,
      { [key]: v } as Partial<TemplateSlot>,
      { coalesceKey: `transform:${slot.id}:${key}`, label: "변환" },
    );
  };

  return (
    <Section title="변환">
      <Row>
        <NumericInput label="X" value={slot.x} suffix="px" onChange={(v) => updateNum("x", v)} />
        <NumericInput label="Y" value={slot.y} suffix="px" onChange={(v) => updateNum("y", v)} />
      </Row>
      <Row>
        <NumericInput label="W" value={slot.w} min={1} suffix="px" onChange={(v) => updateNum("w", v)} />
        <NumericInput label="H" value={slot.h} min={1} suffix="px" onChange={(v) => updateNum("h", v)} />
      </Row>
      <Row>
        <NumericInput
          label="∠"
          value={slot.rotation ?? 0}
          step={1}
          suffix="°"
          onChange={(v) => updateNum("rotation", v)}
        />
        <button
          type="button"
          className="ps-tool-button"
          style={{ width: 24, height: 22 }}
          onClick={() => updateNum("rotation", 0)}
          title="회전 초기화"
          aria-label="회전 초기화"
        >
          <RotateCcw className="size-3" />
        </button>
      </Row>
    </Section>
  );
}

function ImageSection({ slot }: { slot: ImageSlot }) {
  const ctx = useEditorContext();

  return (
    <Section title="이미지">
      <Row>
        <span className="ps-label w-12">맞춤</span>
        <Select
          value={slot.fit}
          onValueChange={(v) =>
            ctx.patchSlot(slot.id, { fit: v as ImageSlot["fit"] }, { label: "이미지 맞춤" })
          }
        >
          <SelectTrigger className="ps-select flex-1 h-6">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[var(--ps-bg-elevated)] border-[var(--ps-border)] text-[var(--ps-text)]">
            <SelectItem value="cover">Cover (꽉 채움)</SelectItem>
            <SelectItem value="contain">Contain (모두 표시)</SelectItem>
            <SelectItem value="fill">Fill (강제 늘이기)</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      <Row>
        <NumericInput
          label="R"
          value={slot.borderRadius ?? 0}
          min={0}
          step={1}
          suffix="px"
          title="모서리 반경"
          onChange={(v) =>
            ctx.patchSlot(
              slot.id,
              { borderRadius: Math.max(0, Math.round(v)) },
              { coalesceKey: `radius:${slot.id}`, label: "모서리 반경" },
            )
          }
        />
      </Row>
      <Row>
        <span className="ps-label w-12">URL</span>
        <Input
          value={slot.fallbackUrl ?? ""}
          onChange={(e) =>
            ctx.patchSlot(slot.id, { fallbackUrl: e.target.value }, { coalesceKey: `url:${slot.id}`, label: "이미지 URL" })
          }
          placeholder="binding 결과가 비면 사용"
          className="h-6 text-[11px] flex-1"
        />
      </Row>
    </Section>
  );
}

function BindingSection({ slot }: { slot: TemplateSlot }) {
  const ctx = useEditorContext();
  return (
    <Section title="데이터 바인딩">
      <ScheduleTemplateBindingField
        slotType={slot.type}
        value={slot.binding}
        literal={slot.type === "text" ? (slot as { literal?: string }).literal : undefined}
        onChange={(next) =>
          ctx.patchSlot(slot.id, { binding: next } as Partial<TemplateSlot>, { label: "바인딩 변경" })
        }
        id={`binding-${slot.id}`}
      />
    </Section>
  );
}

// ─────────────────────────────────────────────
// 공통 helpers (panels 전반에서 재사용)
// ─────────────────────────────────────────────

export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <div
        className="text-[10px] uppercase tracking-wider px-1"
        style={{ color: "var(--ps-text-muted)" }}
      >
        {title}
      </div>
      <div className="space-y-1.5 px-1">{children}</div>
    </section>
  );
}

export function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-1.5">{children}</div>;
}

// 미사용 placeholder import suppression
void FlipHorizontal2;
void FlipVertical2;
