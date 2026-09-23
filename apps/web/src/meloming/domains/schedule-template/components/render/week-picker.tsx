"use client";

import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { Button } from "@/meloming/shared/components/ui/button";
import {
  formatWeekRangeLabel,
  getKstWeekStart,
  isSameWeek,
  shiftWeek,
} from "./week-utils";

interface WeekPickerProps {
  /** KST 월요일 자정에 해당하는 UTC Date. 외부(상위) 에서 state 관리. */
  value: Date;
  onChange: (next: Date) => void;
  disabled?: boolean;
}

/**
 * KST 월요일 자정 기준 주 선택기.
 *
 * - "이전 주" / "다음 주" 버튼으로 7일 단위 이동
 * - "이번 주" 버튼은 오늘이 속한 KST 주로 되돌림 (이미 이번 주면 disabled)
 * - 레인지 라벨은 `4/21 (월) - 4/27 (일)` 형태
 *
 * 월요일 오프셋 계산은 `week-utils.getKstWeekStart` 에 위임해 단위 테스트
 * 하기 쉽도록 했다.
 */
export function WeekPicker({ value, onChange, disabled = false }: WeekPickerProps) {
  const label = formatWeekRangeLabel(value);
  const thisWeek = getKstWeekStart();
  const isThisWeek = isSameWeek(value, thisWeek);

  const handlePrev = () => onChange(shiftWeek(value, -1));
  const handleNext = () => onChange(shiftWeek(value, 1));
  const handleThisWeek = () => onChange(thisWeek);

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handlePrev}
        disabled={disabled}
        aria-label="이전 주"
      >
        <ChevronLeft className="size-4" />
      </Button>
      <div className="flex-1 text-center">
        <p className="text-xs text-muted-foreground">KST 기준 주</p>
        <p className="text-sm font-semibold" data-testid="week-picker-label">
          {label}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleThisWeek}
          disabled={disabled || isThisWeek}
          aria-label="이번 주로 복귀"
          title="이번 주"
        >
          <RotateCcw className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleNext}
          disabled={disabled}
          aria-label="다음 주"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
