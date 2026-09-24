/**
 * Parse preview options JSON string from query params.
 */
export const parsePreviewOptions = (
  value?: string | null,
): Record<string, unknown> | null => {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore malformed preview payloads and fall back to saved settings.
  }
  return null;
};
