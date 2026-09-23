'use client';

import { Slider } from '@/meloming/shared/components/ui/slider';
import type { ThemeOptionSchemaEntry } from '@/meloming/domains/channel/apis/overlay-theme';
import { SettingsRow } from '@/meloming/shared/components/common/settings-form';

interface RangeFieldProps {
  field: ThemeOptionSchemaEntry;
  value: number;
  onChange: (value: number) => void;
}

/**
 * Slider input for numeric range options.
 *
 * Uses `field.min`, `field.max`, and `field.step` from the schema. Displays
 * the current numeric value (with optional `field.unit` suffix) beside the
 * label so users see the precise value they're editing.
 *
 * For fractional `step` values (e.g. 0.05), the displayed value is rounded
 * to the step's decimal precision so we avoid floating-point drift like
 * `0.7500000000000001` in the UI.
 */
export function RangeField({ field, value, onChange }: RangeFieldProps) {
  const fieldId = `theme-option-${field.key}`;
  const min = field.min ?? 0;
  const max = field.max ?? 100;
  const step = field.step ?? 1;
  const numericValue = typeof value === 'number' && Number.isFinite(value) ? value : min;

  // Decimal places derived from step (1 → 0, 0.05 → 2, 0.001 → 3, etc.)
  const stepStr = String(step);
  const decimals = stepStr.includes('.') ? stepStr.split('.')[1]!.length : 0;
  const displayValue = decimals > 0 ? numericValue.toFixed(decimals) : String(numericValue);
  const unitSuffix = field.unit ?? '';

  return (
    <SettingsRow title={field.label} description={field.helpText}>
      <div className="space-y-2">
        <div className="flex justify-end">
        <span className="text-sm text-muted-foreground tabular-nums">
          {displayValue}
          {unitSuffix}
        </span>
      </div>
      <Slider
        id={fieldId}
        value={[numericValue]}
        onValueChange={([next]) => onChange(next)}
        min={min}
        max={max}
        step={step}
        aria-label={field.label}
      />
      </div>
    </SettingsRow>
  );
}
