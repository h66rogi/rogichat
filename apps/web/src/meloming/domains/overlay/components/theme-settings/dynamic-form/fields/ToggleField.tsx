'use client';

import { Switch } from '@/meloming/shared/components/ui/switch';
import type { ThemeOptionSchemaEntry } from '@/meloming/domains/channel/apis/overlay-theme';
import { SettingsRow } from '@/meloming/shared/components/common/settings-form';

interface ToggleFieldProps {
  field: ThemeOptionSchemaEntry;
  value: boolean;
  onChange: (value: boolean) => void;
}

/**
 * Boolean switch input.
 *
 * Renders the toggle on the left and the label on the right so the click
 * target reads naturally as "[switch] [label]".
 */
export function ToggleField({ field, value, onChange }: ToggleFieldProps) {
  const fieldId = `theme-option-${field.key}`;
  const checked = Boolean(value);

  return (
    <SettingsRow
      title={field.label}
      description={field.helpText}
      controlClassName="flex items-start sm:justify-end"
    >
      <Switch
        id={fieldId}
        checked={checked}
        onCheckedChange={onChange}
        aria-label={field.label}
      />
    </SettingsRow>
  );
}
