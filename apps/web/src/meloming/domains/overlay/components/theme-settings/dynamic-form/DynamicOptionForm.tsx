'use client';

import { Fragment, useMemo } from 'react';
import type {
  ThemeCatalogEntry,
  ThemeOptionSchemaEntry,
} from '@/meloming/domains/channel/apis/overlay-theme';
import { ColorField } from './fields/ColorField';
import { RangeField } from './fields/RangeField';
import { SelectField } from './fields/SelectField';
import { ToggleField } from './fields/ToggleField';
import { FontField } from './fields/FontField';
import { NumberField } from './fields/NumberField';
import { TextField } from './fields/TextField';

interface DynamicOptionFormProps {
  /** Schema entries describing the editable options. */
  schema: ThemeOptionSchemaEntry[];
  /** Current values keyed by option `key`. */
  values: Record<string, unknown>;
  /** Called when the user edits a single option. */
  onChange: (key: string, value: unknown) => void;
  /** Theme catalog entry — passed through to FontField for font lists. */
  theme?: ThemeCatalogEntry;
}

const DEFAULT_GROUP = 'general';

/**
 * Keys backend adds to every theme's `optionSchema`. We render these as a
 * single "공통 (텍스트·폰트·색상)" section at the top of the form,
 * regardless of how the backend assigned their `group`.
 */
const COMMON_OPTION_KEYS = new Set<string>([
  'fontFamily',
  'textSize',
  'textWeight',
  'textColor',
  'accentColor',
  'backgroundOpacity',
  'borderOpacity',
  'blurIntensity',
]);

const COMMON_SECTION_LABEL = '공통 (텍스트·폰트·색상)';
const THEME_SPECIFIC_SECTION_LABEL = '테마별 옵션';

/**
 * Korean display labels for known group keys. Unknown groups fall back to the
 * raw group key so theme authors can introduce new groups without code changes.
 */
const GROUP_LABELS: Record<string, string> = {
  colors: '색상',
  typography: '타이포그래피',
  effects: '효과',
  layout: '레이아웃',
  general: '일반',
};

interface GroupedFields {
  group: string;
  label: string;
  fields: ThemeOptionSchemaEntry[];
}

function getGroupLabel(group: string): string {
  return GROUP_LABELS[group] ?? group;
}

/**
 * Returns whether a field should be visible given the current option values.
 *
 * A field with no `dependsOn` is always visible. Otherwise we look up the
 * referenced option key and compare strict-equally with the expected value.
 */
function isFieldVisible(
  field: ThemeOptionSchemaEntry,
  values: Record<string, unknown>
): boolean {
  if (!field.dependsOn) return true;
  return values[field.dependsOn.key] === field.dependsOn.value;
}

/**
 * Groups schema entries by their `group` property, preserving the order in
 * which each group is first encountered. Fields with no group are bucketed
 * under `general`.
 */
function groupSchema(schema: ThemeOptionSchemaEntry[]): GroupedFields[] {
  const ordered: string[] = [];
  const buckets = new Map<string, ThemeOptionSchemaEntry[]>();

  for (const field of schema) {
    const group = field.group ?? DEFAULT_GROUP;
    if (!buckets.has(group)) {
      buckets.set(group, []);
      ordered.push(group);
    }
    buckets.get(group)!.push(field);
  }

  return ordered.map((group) => ({
    group,
    label: getGroupLabel(group),
    fields: buckets.get(group)!,
  }));
}

/**
 * Renders the appropriate input component for a single schema entry.
 *
 * Centralized here so the parent only worries about layout and grouping.
 * Each field component is responsible for narrowing/coercing the `unknown`
 * value to its expected type.
 */
/**
 * Field 타입별 안전한 default 추출. catalog의 `field.default`는 unknown 타입이라
 * narrowing 없이는 컴포넌트 prop 시그니처에 맞지 않는다. value가 비어 있을 때
 * field.default로 fallback해야 override 진입 직후 form이 실제 widget 렌더와
 * 동일한 값을 보여준다 (이전엔 ''/false/0이 보여 catalog default와 불일치).
 */
function pickStringDefault(field: ThemeOptionSchemaEntry): string {
  return typeof field.default === 'string' ? field.default : '';
}
function pickBooleanDefault(field: ThemeOptionSchemaEntry): boolean {
  return typeof field.default === 'boolean' ? field.default : false;
}
function pickNumberDefault(field: ThemeOptionSchemaEntry): number {
  if (typeof field.default === 'number' && Number.isFinite(field.default)) {
    return field.default;
  }
  return field.min ?? 0;
}
function pickSelectDefault(
  field: ThemeOptionSchemaEntry,
): string | number | boolean {
  const d = field.default;
  if (typeof d === 'string' || typeof d === 'number' || typeof d === 'boolean') {
    return d;
  }
  return '';
}

function renderField(
  field: ThemeOptionSchemaEntry,
  value: unknown,
  onChange: (key: string, value: unknown) => void,
  theme?: ThemeCatalogEntry
) {
  switch (field.type) {
    case 'color':
      return (
        <ColorField
          field={field}
          value={typeof value === 'string' ? value : pickStringDefault(field)}
          onChange={(next) => onChange(field.key, next)}
        />
      );
    case 'range':
      return (
        <RangeField
          field={field}
          value={
            typeof value === 'number' && Number.isFinite(value)
              ? value
              : pickNumberDefault(field)
          }
          onChange={(next) => onChange(field.key, next)}
        />
      );
    case 'select':
      return (
        <SelectField
          field={field}
          value={
            value === undefined || value === null
              ? pickSelectDefault(field)
              : (value as string | number | boolean)
          }
          onChange={(next) => onChange(field.key, next)}
        />
      );
    case 'toggle':
      return (
        <ToggleField
          field={field}
          value={typeof value === 'boolean' ? value : pickBooleanDefault(field)}
          onChange={(next) => onChange(field.key, next)}
        />
      );
    case 'font':
      return (
        <FontField
          field={field}
          value={typeof value === 'string' ? value : pickStringDefault(field)}
          onChange={(next) => onChange(field.key, next)}
          theme={theme}
        />
      );
    case 'number':
      return (
        <NumberField
          field={field}
          value={
            typeof value === 'number' && Number.isFinite(value)
              ? value
              : pickNumberDefault(field)
          }
          onChange={(next) => onChange(field.key, next)}
        />
      );
    case 'text':
      return (
        <TextField
          field={field}
          value={typeof value === 'string' ? value : pickStringDefault(field)}
          onChange={(next) => onChange(field.key, next)}
        />
      );
    default:
      return null;
  }
}

/**
 * Orders common options in the same sequence as `COMMON_OPTION_KEYS` (insertion
 * order) so the layout is predictable regardless of backend ordering.
 */
function sortCommonFields(fields: ThemeOptionSchemaEntry[]): ThemeOptionSchemaEntry[] {
  const order = Array.from(COMMON_OPTION_KEYS);
  return [...fields].sort(
    (a, b) => order.indexOf(a.key) - order.indexOf(b.key)
  );
}

/**
 * Generates a settings form from a theme's `optionSchema`.
 *
 * Behavior:
 * - Fields whose `key` is in `COMMON_OPTION_KEYS` (fontFamily, textSize,
 *   textWeight, textColor, accentColor) are pulled into a single
 *   "공통 (텍스트·폰트·색상)" section at the top, regardless of the
 *   backend-assigned `group`.
 * - Remaining theme-specific fields are rendered beneath under
 *   "테마별 옵션", subdivided by their `group` property (with Korean
 *   labels for known groups) so existing per-group headings are preserved.
 * - Fields whose `dependsOn` condition isn't satisfied are filtered out
 *   before rendering, so the parent's `values` map drives visibility.
 * - The actual input component is selected by `field.type`.
 *
 * The form is a controlled component: the parent owns `values` and reacts
 * to `onChange` to persist edits.
 */
export function DynamicOptionForm({
  schema,
  values,
  onChange,
  theme,
}: DynamicOptionFormProps) {
  const { commonFields, themeSpecificGroups } = useMemo(() => {
    const common: ThemeOptionSchemaEntry[] = [];
    const specific: ThemeOptionSchemaEntry[] = [];
    for (const field of schema) {
      if (COMMON_OPTION_KEYS.has(field.key)) {
        common.push(field);
      } else {
        specific.push(field);
      }
    }
    return {
      commonFields: sortCommonFields(common),
      themeSpecificGroups: groupSchema(specific),
    };
  }, [schema]);

  const visibleCommon = useMemo(
    () => commonFields.filter((field) => isFieldVisible(field, values)),
    [commonFields, values]
  );

  const visibleThemeGroups = useMemo(
    () =>
      themeSpecificGroups
        .map((group) => ({
          ...group,
          fields: group.fields.filter((field) => isFieldVisible(field, values)),
        }))
        .filter((group) => group.fields.length > 0),
    [themeSpecificGroups, values]
  );

  if (visibleCommon.length === 0 && visibleThemeGroups.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        편집 가능한 옵션이 없습니다.
      </p>
    );
  }

  return (
    <div className="space-y-8">
      {visibleCommon.length > 0 && (
        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-foreground">
            {COMMON_SECTION_LABEL}
          </h3>
          <div className="rounded-md border px-4">
            {visibleCommon.map((field) => (
              <Fragment key={field.key}>
                {renderField(field, values[field.key], onChange, theme)}
              </Fragment>
            ))}
          </div>
        </section>
      )}
      {visibleThemeGroups.length > 0 && (
        <section className="space-y-6">
          <h3 className="text-sm font-semibold text-foreground">
            {THEME_SPECIFIC_SECTION_LABEL}
          </h3>
          <div className="space-y-8">
            {visibleThemeGroups.map((group) => (
              <section key={group.group} className="space-y-4">
                <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </h4>
                <div className="rounded-md border px-4">
                  {group.fields.map((field) => (
                    <Fragment key={field.key}>
                      {renderField(field, values[field.key], onChange, theme)}
                    </Fragment>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
