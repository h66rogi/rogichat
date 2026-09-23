'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/meloming/shared/components/ui/select';
import type {
  ThemeCatalogEntry,
  ThemeFontSpec,
  ThemeOptionSchemaEntry,
} from '@/meloming/domains/channel/apis/overlay-theme';
import { SettingsRow } from '@/meloming/shared/components/common/settings-form';

interface FontFieldProps {
  field: ThemeOptionSchemaEntry;
  value: string;
  onChange: (value: string) => void;
  theme?: ThemeCatalogEntry;
}

const CUSTOM_OPTION_VALUE = '__custom__';

/**
 * Build a single Google Fonts CSS2 URL for the given families. Weights in each
 * spec are used if present; otherwise we fall back to Google's default weight.
 *
 * The CSS2 endpoint expects families in the form
 * `family=Name:wght@400;500;700&family=Name2:wght@400`.
 */
function buildGoogleFontsHref(specs: ThemeFontSpec[]): string | null {
  if (specs.length === 0) return null;
  const families = specs.map((spec) => {
    const familyParam = encodeURIComponent(spec.family).replace(/%20/g, '+');
    const weights = (spec.weights ?? []).filter(
      (w) => typeof w === 'number' && w > 0
    );
    if (weights.length === 0) {
      return `family=${familyParam}`;
    }
    const sorted = [...new Set(weights)].sort((a, b) => a - b);
    return `family=${familyParam}:wght@${sorted.join(';')}`;
  });
  return `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`;
}

/**
 * Injects (once) a `<link rel="stylesheet">` pointing at Google Fonts for all
 * `source === 'google'` specs in the dropdown. Dedupes by URL so repeated
 * openings of the dropdown don't stack duplicate links.
 *
 * We load these lazily — only when the dropdown is open — to avoid paying
 * the network cost on every form render.
 */
function useGoogleFontsPreview(specs: ThemeFontSpec[], enabled: boolean) {
  const googleSpecs = useMemo(
    () => specs.filter((spec) => spec.source === 'google'),
    [specs]
  );
  const href = useMemo(() => buildGoogleFontsHref(googleSpecs), [googleSpecs]);

  useEffect(() => {
    if (!enabled || !href || typeof document === 'undefined') return;
    // Dedupe: if a link with the same href is already present, skip.
    const existing = document.head.querySelector<HTMLLinkElement>(
      `link[data-theme-font-preview="${href}"]`
    );
    if (existing) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute('data-theme-font-preview', href);
    document.head.appendChild(link);
    // Keep the link in the head even after unmount — fonts may still be
    // referenced by the selected family for a moment after close, and the
    // dedupe guard prevents unbounded growth across sessions.
  }, [enabled, href]);
}

/**
 * Font family picker.
 *
 * Renders the theme's `fonts.recommended` and `fonts.bundled` families as
 * grouped options, plus a disabled "+ 커스텀 폰트" placeholder for future work.
 *
 * Preview: each option label is rendered in its own font-family so users see
 * the actual font shape. Google Fonts are loaded via an injected
 * `<link rel="stylesheet">` when the dropdown is open — this keeps the
 * management page from paying the network cost until the user actually
 * opens the picker.
 *
 * If the current `value` is not present in either recommended or bundled
 * lists (e.g. a legacy custom selection), it is added to the dropdown as a
 * standalone option so the user can see what's currently set.
 */
export function FontField({ field, value, onChange, theme }: FontFieldProps) {
  const fieldId = `theme-option-${field.key}`;
  const [open, setOpen] = useState(false);

  const { recommended, bundled, custom, allVisibleSpecs } = useMemo(() => {
    const recommendedList = theme?.fonts.recommended ?? [];
    const bundledList = theme?.fonts.bundled ?? [];

    const isInList = (family: string) =>
      recommendedList.some((font) => font.family === family) ||
      bundledList.some((font) => font.family === family);

    const currentFamily = typeof value === 'string' ? value : '';
    const customSpec: ThemeFontSpec | null =
      currentFamily && !isInList(currentFamily)
        ? { family: currentFamily, source: 'unknown', weights: [] }
        : null;

    const combined = [
      ...recommendedList,
      ...bundledList,
      ...(customSpec ? [customSpec] : []),
    ];

    return {
      recommended: recommendedList,
      bundled: bundledList,
      custom: customSpec,
      allVisibleSpecs: combined,
    };
  }, [theme, value]);

  useGoogleFontsPreview(allVisibleSpecs, open);

  const handleValueChange = (next: string) => {
    if (next === CUSTOM_OPTION_VALUE) {
      // Placeholder: will open a Google Fonts search dialog in a later phase.
      return;
    }
    onChange(next);
  };

  const currentValue = typeof value === 'string' && value ? value : undefined;

  return (
    <SettingsRow title={field.label} description={field.helpText}>
      <Select
        value={currentValue}
        onValueChange={handleValueChange}
        onOpenChange={setOpen}
      >
        <SelectTrigger
          id={fieldId}
          aria-label={field.label}
          style={
            currentValue
              ? { fontFamily: `'${currentValue}', sans-serif` }
              : undefined
          }
        >
          <SelectValue placeholder="폰트 선택" />
        </SelectTrigger>
        <SelectContent>
          {recommended.length > 0 && (
            <SelectGroup>
              <SelectLabel>추천 폰트</SelectLabel>
              {recommended.map((font) => (
                <SelectItem
                  key={`recommended-${font.family}`}
                  value={font.family}
                  style={{ fontFamily: `'${font.family}', sans-serif` }}
                >
                  {font.displayName ?? font.family}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {bundled.length > 0 && (
            <SelectGroup>
              {recommended.length > 0 && <SelectSeparator />}
              <SelectLabel>기본 제공 폰트</SelectLabel>
              {bundled.map((font) => (
                <SelectItem
                  key={`bundled-${font.family}`}
                  value={font.family}
                  style={{ fontFamily: `'${font.family}', sans-serif` }}
                >
                  {font.displayName ?? font.family}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {custom && (
            <SelectGroup>
              <SelectSeparator />
              <SelectLabel>현재 폰트</SelectLabel>
              <SelectItem
                value={custom.family}
                style={{ fontFamily: `'${custom.family}', sans-serif` }}
              >
                {custom.displayName ?? custom.family}
              </SelectItem>
            </SelectGroup>
          )}
          <SelectSeparator />
          <SelectItem value={CUSTOM_OPTION_VALUE} disabled>
            + 커스텀 폰트 (추후 지원)
          </SelectItem>
        </SelectContent>
      </Select>
    </SettingsRow>
  );
}
