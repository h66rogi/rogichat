"use client";

import Link from "next/link";
import { AlertCircle, LayoutTemplate } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/meloming/shared/components/ui/select";
import { Skeleton } from "@/meloming/shared/components/ui/skeleton";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/meloming/shared/components/ui/alert";
import { Button } from "@/meloming/shared/components/ui/button";
import type { ScheduleTemplate } from "@/meloming/domains/schedule-template/types";

interface TemplatePickerProps {
  templates: ScheduleTemplate[] | undefined;
  value: number | null;
  onChange: (templateId: number) => void;
  isLoading?: boolean;
  /** `schedule-templates` 목록 페이지로 가는 링크 (empty state 용) */
  templatesHref: string;
  disabled?: boolean;
}

/**
 * 기존 시간표 템플릿 중 하나를 고르는 드롭다운.
 *
 * - 템플릿 없음: 인라인 Alert + 목록 페이지 링크 (UX 규칙: 모달 depth 금지)
 * - 로딩 중: skeleton
 * - 값이 없고 템플릿이 있으면 호출 측에서 기본값 주입 (placeholder 만 보여줌)
 */
export function TemplatePicker({
  templates,
  value,
  onChange,
  isLoading = false,
  templatesHref,
  disabled = false,
}: TemplatePickerProps) {
  if (isLoading) {
    return <Skeleton className="h-9 w-full" />;
  }

  if (!templates || templates.length === 0) {
    return (
      <Alert>
        <AlertCircle className="size-4" />
        <AlertTitle>등록된 템플릿이 없어요</AlertTitle>
        <AlertDescription className="flex flex-col gap-2">
          <span>
            먼저 시간표 템플릿을 만들어주세요. 베이스 이미지 + 슬롯 배치를
            저장해두면 이 화면에서 바로 주간 이미지를 생성할 수 있어요.
          </span>
          <Button asChild variant="outline" size="sm" className="self-start">
            <Link href={templatesHref}>
              <LayoutTemplate className="size-3.5" />
              템플릿 만들러 가기
            </Link>
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Select
      value={value !== null ? String(value) : undefined}
      onValueChange={(next) => {
        const parsed = Number(next);
        if (Number.isFinite(parsed)) {
          onChange(parsed);
        }
      }}
      disabled={disabled}
    >
      <SelectTrigger
        className="w-full"
        aria-label="시간표 템플릿 선택"
        data-testid="template-picker-trigger"
      >
        <SelectValue placeholder="템플릿을 선택하세요" />
      </SelectTrigger>
      <SelectContent>
        {templates.map((template) => (
          <SelectItem key={template.id} value={String(template.id)}>
            <span className="flex items-center gap-2">
              <span className="truncate">{template.name}</span>
              {template.isDefault && (
                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold leading-none text-emerald-600 dark:text-emerald-400">
                  기본
                </span>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
