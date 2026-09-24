'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/meloming/shared/components/ui/select';
import type {
  ThemeOptionChoice,
  ThemeOptionSchemaEntry,
} from '@/meloming/domains/channel/apis/overlay-theme';
import { SettingsRow } from '@/meloming/shared/components/common/settings-form';

interface SelectFieldProps {
  field: ThemeOptionSchemaEntry;
  value: string | number | boolean;
  onChange: (value: string | number | boolean) => void;
}

/**
 * Dropdown select bound to `field.choices`.
 *
 * Choice values can be string | number | boolean, but the underlying shadcn
 * Select component only accepts string values. We stringify each choice for
 * the trigger and look up the original-typed value when the user selects a
 * new option, so the parent always receives the correctly-typed value.
 */
function stringifyChoice(value: ThemeOptionChoice['value']): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

export function SelectField({ field, value, onChange }: SelectFieldProps) {
  const fieldId = `theme-option-${field.key}`;
  const choices = field.choices ?? [];
  const stringValue = stringifyChoice(value as ThemeOptionChoice['value']);

  const handleValueChange = (next: string) => {
    const matched = choices.find(
      (choice) => stringifyChoice(choice.value) === next
    );
    if (matched) {
      onChange(matched.value);
    }
  };

  return (
    <SettingsRow title={field.label} description={field.helpText}>
      <Select value={stringValue} onValueChange={handleValueChange}>
        <SelectTrigger id={fieldId} aria-label={field.label}>
          <SelectValue placeholder="선택" />
        </SelectTrigger>
        <SelectContent>
          {choices.map((choice) => {
            const optionValue = stringifyChoice(choice.value);
            return (
              <SelectItem key={optionValue} value={optionValue}>
                {choice.label}
              </SelectItem>
          );
        })}
      </SelectContent>
      </Select>
    </SettingsRow>
  );
}
