import type { CSSProperties } from 'react';

export interface ResolvedTextStroke {
  enabled: boolean;
  color: string;
  width: number;
}

interface TextStrokeDefaults {
  enabled?: boolean;
  color?: string;
  width?: number;
}

/**
 * Resolves the `textStroke*` option keys off a raw theme options record.
 * Inputs may arrive as numbers, numeric strings, or be omitted entirely;
 * any unparseable value falls back to the theme default.
 */
export function resolveTextStroke(
  options: Record<string, unknown> | null | undefined,
  defaults: TextStrokeDefaults = {},
): ResolvedTextStroke {
  const o = (options ?? {}) as Record<string, unknown>;

  // Fallback default 는 false. catalog 에서 buildCommonDefaultOptions 가
  // textStrokeEnabled: false 를 모든 테마 defaultOptions 에 넣어주고
  // billboard 만 spread 후 override 로 true 를 명시한다. 채널 옵션이
  // 아직 catalog 새 default 로 갱신 안 됐거나 누락된 경우에도 안전하게
  // 꺼진 상태가 되도록 fallback 을 false 로 둔다 — billboard 특수 케이스
  // 외엔 외곽선이 적용되면 안 된다는 사용자 원칙과 일치.
  const enabled =
    typeof o.textStrokeEnabled === 'boolean'
      ? o.textStrokeEnabled
      : defaults.enabled ?? false;

  const colorRaw = o.textStrokeColor;
  const color =
    typeof colorRaw === 'string' && colorRaw.trim()
      ? colorRaw
      : defaults.color ?? '#000000';

  const widthRaw = o.textStrokeWidth;
  const widthNum =
    typeof widthRaw === 'number'
      ? widthRaw
      : Number.parseFloat(String(widthRaw ?? ''));
  const width = Number.isFinite(widthNum)
    ? Math.max(0, Math.min(8, widthNum))
    : defaults.width ?? 1.5;

  return { enabled, color, width };
}

/**
 * Returns a CSSProperties fragment that applies a true text outline using
 * `-webkit-text-stroke` + `paint-order: stroke fill`. The stroke is painted
 * BEHIND the fill, so AA fringing / miter-join artifacts are masked by the
 * fill glyph. Unlike the previous drop-letter approach (which offset a copy
 * of the glyph outside the box), the stroke is painted INSIDE each glyph's
 * shape — so it is never clipped by the parent container's `overflow:hidden`
 * or ellipsis truncation boundary.
 *
 * Both `-webkit-text-stroke` and `paint-order` inherit, so applying this on
 * the wrapper covers all descendant text nodes automatically.
 *
 * Empty object when disabled so callers can spread unconditionally.
 */
export function buildTextStrokeStyle(
  stroke: ResolvedTextStroke,
): CSSProperties {
  if (!stroke.enabled || stroke.width <= 0) return {};
  return {
    WebkitTextStroke: `${stroke.width}px ${stroke.color}`,
    paintOrder: 'stroke fill',
  };
}

/**
 * Pass-through for an existing `text-shadow` value (typically a soft drop
 * shadow used by transparent-background widgets). Kept as a stable call site
 * shape after the stroke implementation moved off `text-shadow` entirely —
 * the `stroke` argument is no longer composed in here, since the outline is
 * now applied via `buildTextStrokeStyle` on the wrapper.
 */
export function withTextStroke(
  _stroke: ResolvedTextStroke,
  existing?: string,
): string | undefined {
  return existing && existing !== 'none' ? existing : undefined;
}
