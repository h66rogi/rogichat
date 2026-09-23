"use client";

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
} from "lucide-react";
import type {
  TextSlot,
  TextSlotFont,
} from "@/meloming/domains/schedule-template/types/template-spec";
import { useEditorContext } from "../state/editor-context";
import { Row, Section } from "./properties-panel";

/**
 * Paragraph 패널 — Photoshop "단락" 패널.
 *
 * 정렬, 들여쓰기, 단락 간격. 우리 데이터 모델은 단락 단위 indent / 간격이 없으므로
 * 정렬만 노출 + 추후 확장 안내.
 */
export function ParagraphPanel() {
  const ctx = useEditorContext();
  const slot = ctx.singleSelectedSlot;
  const text = slot && slot.type === "text" ? (slot as TextSlot) : null;

  return (
    <div className="flex flex-col h-full">
      <div className="ps-panel-header">단락</div>
      <div className="ps-panel-body p-2">
        {!text ? (
          <p className="text-[11px] text-[var(--ps-text-muted)] p-2">
            텍스트 레이어를 선택하면 표시됩니다.
          </p>
        ) : (
          <ParagraphFields text={text} />
        )}
      </div>
    </div>
  );
}

function ParagraphFields({ text }: { text: TextSlot }) {
  const ctx = useEditorContext();
  const setAlign = (align: TextSlotFont["align"]) => {
    ctx.patchSlot(
      text.id,
      { font: { ...text.font, align } } as Partial<TextSlot>,
      { label: `정렬: ${align}` },
    );
  };

  return (
    <div className="space-y-3">
      <Section title="정렬">
        <Row>
          <AlignButton
            active={text.font.align === "left"}
            Icon={AlignLeft}
            label="왼쪽"
            onClick={() => setAlign("left")}
          />
          <AlignButton
            active={text.font.align === "center"}
            Icon={AlignCenter}
            label="가운데"
            onClick={() => setAlign("center")}
          />
          <AlignButton
            active={text.font.align === "right"}
            Icon={AlignRight}
            label="오른쪽"
            onClick={() => setAlign("right")}
          />
        </Row>
      </Section>
    </div>
  );
}

function AlignButton({
  active,
  Icon,
  label,
  onClick,
}: {
  active: boolean;
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`ps-tool-button ${active ? "is-active" : ""}`}
      style={{ width: 28, height: 24 }}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
    >
      <Icon className="size-3.5" />
    </button>
  );
}
