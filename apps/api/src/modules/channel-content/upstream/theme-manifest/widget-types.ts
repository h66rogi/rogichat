/**
 * Widget types supported by the theme system.
 *
 * Legacy widgets such as `alertbox` / `total` are not part of the
 * theme catalog (they are routed via the legacy layoutType pipeline).
 */

export const WIDGET_TYPES = [
  'now-playing',
  'queue',
  'chatbox',
  'setlist',
  'lyrics',
  'songbook-qr',
] as const;

export type WidgetType = (typeof WIDGET_TYPES)[number];

export function isValidWidgetType(value: string): value is WidgetType {
  return (WIDGET_TYPES as readonly string[]).includes(value);
}
