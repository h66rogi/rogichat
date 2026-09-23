"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Sparkles, X } from "lucide-react";
import { Button } from "@/meloming/shared/components/ui/button";
import { Input } from "@/meloming/shared/components/ui/input";
import { Label } from "@/meloming/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/meloming/shared/components/ui/select";
import { cn } from "@/meloming/shared/lib/utils";
import {
  BINDING_CATALOG,
  IMAGE_BINDING_CATALOG,
  findBindingOption,
  type BindingOption,
} from "@/meloming/domains/schedule-template/utils/binding-catalog";
import { inferBindingFromLiteral } from "@/meloming/domains/schedule-template/utils/infer-binding-from-literal";

interface ScheduleTemplateBindingFieldProps {
  /** TextSlot/ImageSlot 카탈로그 분기. */
  slotType: "text" | "image";
  /** 현재 binding 값. 비어있으면 literal/fallbackUrl 로 fallback. */
  value: string | undefined;
  /** 빈 문자열로 설정하면 binding 해제 (literal/fallback 사용). */
  onChange: (next: string) => void;
  /**
   * literal 텍스트 — 휴리스틱 추천에 사용. PSD 업로드된 슬롯의 자동 매핑 힌트로 동작.
   * 추천이 현재 value 와 같으면 버튼 숨김.
   */
  literal?: string;
  disabled?: boolean;
  /** 디버그/접근성용 id prefix. */
  id?: string;
}

const NONE_VALUE = "__none__";
const CUSTOM_VALUE = "__custom__";

/**
 * 슬롯 binding (data 연결) 선택 컨트롤.
 *
 * 정책:
 *  - 카탈로그(`BINDING_CATALOG` / `IMAGE_BINDING_CATALOG`) 기반 grouped Select.
 *  - "사용 안 함" = literal/fallbackUrl 로 fallback (`onChange("")`).
 *  - **"직접 입력…"** 옵션 (Phase 2A 보강): 카탈로그에 없는 새 binding 표현을 사용자가
 *    직접 타이핑할 수 있도록 인라인 Input 을 노출. 적용 후에는 "사용자 정의" 그룹에
 *    값 그대로 보존된다 (저장 시 슬롯의 binding 문자열).
 *  - 카탈로그에 없는 사용자 정의 binding (예: PSD 자동 매핑이 만든 표현 또는 손편집) 도
 *    표현식 그대로 추가 항목으로 노출해 사용자가 잃지 않도록 한다.
 *  - PSD 슬롯 등 literal 이 의미를 가질 때만 추천 버튼을 보여준다 (`literal` prop).
 *    추천 결과 == 현재 value 면 노이즈 방지 위해 표시하지 않는다.
 */
export function ScheduleTemplateBindingField({
  slotType,
  value,
  onChange,
  literal,
  disabled,
  id,
}: ScheduleTemplateBindingFieldProps) {
  const catalog =
    slotType === "image" ? IMAGE_BINDING_CATALOG : BINDING_CATALOG;

  // 카탈로그에 없는 binding (사용자 정의) 도 옵션으로 보여주려고 추가 항목 합성.
  // value 가 "" / undefined / 카탈로그 키 중 하나면 별도 항목 불필요.
  const trimmedValue = (value ?? "").trim();
  const isCatalogValue = catalog.some((opt) => opt.key === trimmedValue);
  const customOption: BindingOption | null = useMemo(() => {
    if (!trimmedValue) return null;
    if (isCatalogValue) return null;
    return {
      key: trimmedValue,
      label: `사용자 정의 — ${trimmedValue}`,
      group: "channel", // 그룹 구분이 의미 없으므로 임의 — UI 에서 별도 섹션으로 표시.
    };
  }, [trimmedValue, isCatalogValue]);

  const grouped = useMemo(() => groupCatalog(catalog), [catalog]);

  const suggestion = useMemo(() => {
    if (!literal) return null;
    const inferred = inferBindingFromLiteral(literal);
    if (!inferred) return null;
    if (inferred === trimmedValue) return null;
    // 이미지 슬롯에서 텍스트-only 추천이 나오면 (e.g. day[0].title) 표시 X.
    const opt = findBindingOption(slotType, inferred);
    if (!opt) return null;
    return opt;
  }, [literal, trimmedValue, slotType]);

  // 직접 입력 모드 — Select 에서 "직접 입력…" 클릭 시 토글되며, 인라인 Input 으로
  // 자유 텍스트를 받아 적용. "취소" 또는 빈 입력 적용 시 모드 해제.
  const [customMode, setCustomMode] = useState(false);
  const [customDraft, setCustomDraft] = useState("");
  const customInputRef = useRef<HTMLInputElement | null>(null);

  // 직접 입력 모드 진입 시 자동 포커스 — 사용자가 별도 클릭 없이 타이핑 가능.
  useEffect(() => {
    if (customMode) {
      // 이미 값이 있으면 사전 채워서 수정 편의 제공.
      setCustomDraft(trimmedValue);
      // 다음 프레임에 포커스 (Select 닫힘 애니메이션 직후).
      requestAnimationFrame(() => customInputRef.current?.focus());
    }
    // 의도적으로 trimmedValue 를 deps 에서 제외 — 모드 진입 시점의 현재 값으로 1회 시드.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customMode]);

  const selectValue = trimmedValue === "" ? NONE_VALUE : trimmedValue;
  const labelId = id ? `${id}-label` : undefined;
  const triggerId = id ?? undefined;

  const applyCustom = () => {
    const next = customDraft.trim();
    // 빈 문자열은 binding 해제와 동일 — onChange("") + 모드 종료.
    onChange(next);
    setCustomMode(false);
    setCustomDraft("");
  };

  const cancelCustom = () => {
    setCustomMode(false);
    setCustomDraft("");
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={triggerId} id={labelId}>
        데이터 연결 (Binding)
      </Label>
      <Select
        value={selectValue}
        onValueChange={(next) => {
          if (next === CUSTOM_VALUE) {
            setCustomMode(true);
            return;
          }
          onChange(next === NONE_VALUE ? "" : next);
        }}
        disabled={disabled || customMode}
      >
        <SelectTrigger
          id={triggerId}
          className={cn("w-full")}
          aria-labelledby={labelId}
          data-testid="binding-field-trigger"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={NONE_VALUE}>
              사용 안 함 (literal 텍스트 사용)
            </SelectItem>
            <SelectItem value={CUSTOM_VALUE} data-testid="binding-field-custom-option">
              직접 입력…
            </SelectItem>
          </SelectGroup>
          {customOption && (
            <SelectGroup>
              <SelectLabel>사용자 정의</SelectLabel>
              <SelectItem value={customOption.key}>
                <span className="flex flex-col">
                  <span className="text-sm">{customOption.label}</span>
                  <span className="text-[11px] text-muted-foreground font-mono">
                    {customOption.key}
                  </span>
                </span>
              </SelectItem>
            </SelectGroup>
          )}
          {grouped.map(({ groupKey, label, options }) => (
            <SelectGroup key={groupKey}>
              <SelectLabel>{label}</SelectLabel>
              {options.map((opt) => (
                <SelectItem key={opt.key} value={opt.key}>
                  <span className="flex flex-col">
                    <span className="text-sm">{opt.label}</span>
                    <span className="text-[11px] text-muted-foreground font-mono">
                      {opt.key}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>

      {customMode && (
        <div
          className="flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/5 p-1.5"
          data-testid="binding-field-custom-input-wrapper"
        >
          <Input
            ref={customInputRef}
            value={customDraft}
            onChange={(e) => setCustomDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyCustom();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelCustom();
              }
            }}
            placeholder="예: day[0].title 또는 custom.expression"
            className="h-7 font-mono text-xs"
            disabled={disabled}
            data-testid="binding-field-custom-input"
          />
          <Button
            type="button"
            variant="default"
            size="icon"
            className="size-7 shrink-0"
            onClick={applyCustom}
            disabled={disabled}
            aria-label="직접 입력 적용"
            data-testid="binding-field-custom-apply"
          >
            <Check className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            onClick={cancelCustom}
            disabled={disabled}
            aria-label="직접 입력 취소"
            data-testid="binding-field-custom-cancel"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      )}

      {suggestion && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => onChange(suggestion.key)}
          disabled={disabled}
          data-testid="binding-field-suggestion"
        >
          <Sparkles className="size-3.5" />
          <span className="ml-1">
            추천: {suggestion.label}
            <span className="ml-1 text-muted-foreground">(적용)</span>
          </span>
        </Button>
      )}

      <p className="text-[11px] text-muted-foreground">
        binding 결과가 비거나 실패하면 아래 literal/fallback 이 사용됩니다.
      </p>
    </div>
  );
}

interface GroupedOptions {
  groupKey: string;
  label: string;
  options: BindingOption[];
}

const GROUP_LABELS: Record<BindingOption["group"], string> = {
  channel: "채널",
  week: "주간",
  day: "요일별",
};

/**
 * 카탈로그를 group 별로 묶어 SelectGroup 렌더에 사용.
 * 카탈로그 정의 순서를 보존 (channel → week → day).
 */
function groupCatalog(
  catalog: readonly BindingOption[],
): GroupedOptions[] {
  const seen = new Set<string>();
  const order: BindingOption["group"][] = [];
  for (const opt of catalog) {
    if (!seen.has(opt.group)) {
      seen.add(opt.group);
      order.push(opt.group);
    }
  }
  return order.map((groupKey) => ({
    groupKey,
    label: GROUP_LABELS[groupKey],
    options: catalog.filter((opt) => opt.group === groupKey),
  }));
}
