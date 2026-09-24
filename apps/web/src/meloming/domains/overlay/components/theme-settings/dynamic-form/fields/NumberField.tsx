'use client';

import { Input } from '@/meloming/shared/components/ui/input';
import type { ThemeOptionSchemaEntry } from '@/meloming/domains/channel/apis/overlay-theme';
import { SettingsRow } from '@/meloming/shared/components/common/settings-form';

interface NumberFieldProps {
  field: ThemeOptionSchemaEntry;
  value: number;
  onChange: (value: number) => void;
}

/**
 * Standard numeric input with min/max/step constraints.
 */
export function NumberField({ field, value, onChange }: NumberFieldProps) {
  const fieldId = `theme-option-${field.key}`;
  const numericValue =
    typeof value === 'number' && Number.isFinite(value) ? value : '';

  return (
    <SettingsRow title={field.label} description={field.helpText}>
      <Input
        id={fieldId}
        type="number"
        value={numericValue}
        min={field.min}
        max={field.max}
        step={field.step}
        onChange={(event) => {
          const raw = event.target.value;
          // Empty input = "지우기" intent. Revert to catalog default/min so
          // parent state stays in sync with what's displayed (prior code
          // silent-dropped onChange, leaving stale value in state while UI
          // looked cleared).
          if (raw === '') {
            const fallback: number =
              typeof field.default === 'number'
                ? field.default
                : (field.min ?? 0);
            onChange(fallback);
            return;
          }
          const next = event.target.valueAsNumber;
          if (Number.isFinite(next)) {
            onChange(next);
          }
        }}
        aria-label={field.label}
      />
    </SettingsRow>
  );
}
