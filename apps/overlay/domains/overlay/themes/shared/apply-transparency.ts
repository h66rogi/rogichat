export function hexToRgba(hex: string, alpha: number): string {
  if (!hex || !hex.startsWith('#')) return `rgba(0, 0, 0, ${alpha})`;
  const sanitized = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(sanitized)) {
    return `rgba(0, 0, 0, ${alpha})`;
  }
  const normalized =
    sanitized.length === 3
      ? sanitized
          .split('')
          .map((c) => `${c}${c}`)
          .join('')
      : sanitized;
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function withOpacity(color: string, opacity: number): string {
  if (color.startsWith('#')) {
    return hexToRgba(color, opacity);
  }
  const rgbaMatch = color.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/,
  );
  if (rgbaMatch) {
    const existingAlpha = rgbaMatch[4] != null ? parseFloat(rgbaMatch[4]) : 1;
    return `rgba(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]}, ${existingAlpha * opacity})`;
  }
  return color;
}

export function buildBlurFilter(
  blurPx: number,
  extra?: string,
): string | undefined {
  if (blurPx <= 0 && !extra) return undefined;
  const blur = blurPx > 0 ? `blur(${blurPx}px)` : '';
  if (!extra) return blur || undefined;
  return [blur, extra].filter(Boolean).join(' ') || undefined;
}
