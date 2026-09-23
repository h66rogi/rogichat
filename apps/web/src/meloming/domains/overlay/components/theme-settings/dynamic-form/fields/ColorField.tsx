'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/meloming/shared/components/ui/input';
import { Button } from '@/meloming/shared/components/ui/button';
import type { ThemeOptionSchemaEntry } from '@/meloming/domains/channel/apis/overlay-theme';
import { SettingsRow } from '@/meloming/shared/components/common/settings-form';

interface ColorFieldProps {
  field: ThemeOptionSchemaEntry;
  value: string;
  onChange: (value: string) => void;
}

const FULL_HEX_PATTERN = /^#[0-9a-f]{6}$/;
const SHORT_HEX_PATTERN = /^#[0-9a-f]{3}$/;

/**
 * Normalize hex color input:
 * - `#fff` / `fff` / `#FFF` → `#ffffff`
 * - `#FFFFFF` → `#ffffff`
 * - incomplete input (`#f`, `#ab`) → prefixed lowercase pass-through so the
 *   user can finish typing (UI 표시용; 저장은 commit 단계에서 valid 일 때만).
 *
 * Prevents downstream equality-check drift where the same color is saved
 * as different strings depending on how it was entered.
 */
function normalizeHex(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const hex = trimmed.replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{6}$/.test(hex)) return `#${hex}`;
  if (/^[0-9a-f]{3}$/.test(hex)) {
    return `#${hex.split('').map((c) => c + c).join('')}`;
  }
  return trimmed.startsWith('#') ? `#${hex}` : hex;
}

function isFullCommitableHex(value: string): boolean {
  return value === '' || FULL_HEX_PATTERN.test(value);
}

function isAnyCommitableHex(value: string): boolean {
  return value === '' || FULL_HEX_PATTERN.test(value) || SHORT_HEX_PATTERN.test(value);
}

/**
 * HTML color picker with hex text input.
 *
 * 텍스트 입력은 로컬 draft state로만 유지하다가, valid 6자리 hex / 3자리 hex /
 * 빈 문자열일 때만 부모로 commit. 부분 입력(`#a`, `#ab`)이 widget에 그대로
 * 흘러가 invalid CSS color로 적용되는 것을 차단한다.
 */
export function ColorField({ field, value, onChange }: ColorFieldProps) {
  const fieldId = `theme-option-${field.key}`;
  const normalizedValue = typeof value === 'string' ? value : '';
  const [draft, setDraft] = useState<string | null>(null);

  // 부모 value가 외부에서 변경(다른 preset 적용 등)되면 draft 초기화.
  useEffect(() => {
    setDraft(null);
  }, [normalizedValue]);

  const display = draft ?? normalizedValue;
  const showClear = field.required !== true && display !== '';
  const colorPickerValue = FULL_HEX_PATTERN.test(display.toLowerCase())
    ? display
    : '#000000';

  const fallbackOnInvalid = (): string => {
    if (typeof field.default === 'string' && FULL_HEX_PATTERN.test(field.default.toLowerCase())) {
      return field.default.toLowerCase();
    }
    return normalizedValue;
  };

  const handleTextChange = (raw: string) => {
    setDraft(raw);
    // 타이핑 중에는 6자리 hex(또는 빈 문자열)만 commit. shorthand(#abc) 자동
    // commit이 일어나면 사용자가 #abc123을 치는 도중 #aabbcc로 변환되며
    // useEffect[normalizedValue]가 draft를 reset해 입력이 끊기는 문제 발생.
    // shorthand는 blur에서만 expand 처리.
    const trimmed = raw.trim();
    if (trimmed === '') {
      onChange('');
      return;
    }
    const normalized = normalizeHex(raw);
    if (isFullCommitableHex(normalized) && FULL_HEX_PATTERN.test(normalized)) {
      // 사용자가 직접 6자리 입력했거나(이미 normalized와 동치), 정상 케이스만 commit.
      // raw가 6자리(#로 끝남) 또는 6자리 + #생략의 normalized 결과만 통과.
      const sourceLen = trimmed.replace(/^#/, '').length;
      if (sourceLen >= 6) {
        onChange(normalized);
      }
    }
  };

  const handleTextBlur = () => {
    if (draft === null) return;
    const normalized = normalizeHex(draft);
    if (isAnyCommitableHex(normalized)) {
      // blur 시점엔 shorthand도 expand해서 commit.
      onChange(normalized);
    } else {
      onChange(fallbackOnInvalid());
    }
    setDraft(null);
  };

  return (
    <SettingsRow title={field.label} description={field.helpText}>
      <div className="flex items-center gap-3">
        <Input
          id={fieldId}
          type="color"
          value={colorPickerValue}
          onChange={(event) => onChange(normalizeHex(event.target.value))}
          className="h-10 w-12 cursor-pointer p-1"
          aria-label={`${field.label} 색상 선택`}
        />
        <Input
          value={display}
          onChange={(event) => handleTextChange(event.target.value)}
          onBlur={handleTextBlur}
          placeholder="#000000"
          className="font-mono"
          maxLength={field.maxLength ?? 7}
        />
        {showClear && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => {
              setDraft(null);
              onChange('');
            }}
            aria-label={`${field.label} 초기화`}
          >
            <X className="size-4" />
          </Button>
        )}
      </div>
    </SettingsRow>
  );
}
