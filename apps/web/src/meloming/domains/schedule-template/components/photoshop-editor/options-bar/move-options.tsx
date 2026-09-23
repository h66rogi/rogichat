"use client";

import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
} from "lucide-react";
import { Button } from "@/meloming/shared/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/meloming/shared/components/ui/tooltip";
import { useEditorContext } from "../state/editor-context";

/**
 * 이동 도구 옵션바 — 정렬/분배 + 자동 선택 토글.
 */
export function MoveOptions() {
  const ctx = useEditorContext();
  const count = ctx.selectedSlotIds.length;
  const canAlign = count >= 2;
  const canDistribute = count >= 3;

  return (
    <TooltipProvider delayDuration={400}>
      <span className="ps-label mr-1">정렬:</span>
      <AlignButton
        label="좌측 정렬"
        Icon={AlignStartVertical}
        disabled={!canAlign}
        onClick={() => ctx.alignSelected("left")}
      />
      <AlignButton
        label="가로 가운데"
        Icon={AlignCenterVertical}
        disabled={!canAlign}
        onClick={() => ctx.alignSelected("centerH")}
      />
      <AlignButton
        label="우측 정렬"
        Icon={AlignEndVertical}
        disabled={!canAlign}
        onClick={() => ctx.alignSelected("right")}
      />
      <span className="ps-vsep" />
      <AlignButton
        label="상단 정렬"
        Icon={AlignStartHorizontal}
        disabled={!canAlign}
        onClick={() => ctx.alignSelected("top")}
      />
      <AlignButton
        label="세로 가운데"
        Icon={AlignCenterHorizontal}
        disabled={!canAlign}
        onClick={() => ctx.alignSelected("centerV")}
      />
      <AlignButton
        label="하단 정렬"
        Icon={AlignEndHorizontal}
        disabled={!canAlign}
        onClick={() => ctx.alignSelected("bottom")}
      />

      <span className="ps-vsep" />
      <span className="ps-label mr-1">분배:</span>
      <AlignButton
        label="가로 분배"
        Icon={AlignHorizontalDistributeCenter}
        disabled={!canDistribute}
        onClick={() => ctx.distributeSelected("horizontal")}
      />
      <AlignButton
        label="세로 분배"
        Icon={AlignVerticalDistributeCenter}
        disabled={!canDistribute}
        onClick={() => ctx.distributeSelected("vertical")}
      />
      {/* horizontalGap / verticalGap 변형은 다음 버전에서 추가 — 현재는 horizontal/vertical 만 */}

      <div className="ml-auto flex items-center gap-2 pr-1">
        <span className="ps-label">{count}개 선택됨</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => ctx.duplicateSelected()}
          disabled={count === 0}
          className="h-6 px-2 text-[11px]"
        >
          복제
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => ctx.deleteSelected()}
          disabled={count === 0}
          className="h-6 px-2 text-[11px] text-[var(--destructive)]"
        >
          삭제
        </Button>
      </div>
    </TooltipProvider>
  );
}

interface AlignButtonProps {
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  disabled: boolean;
  onClick: () => void;
}

function AlignButton({ label, Icon, disabled, onClick }: AlignButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="ps-tool-button"
          style={{ width: 28, height: 28 }}
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
        >
          <Icon className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        className="bg-[var(--ps-bg-elevated)] border border-[var(--ps-border)] text-[var(--ps-text)] text-[11px]"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
