import { sanitizeSyncPostHtml } from "@/meloming/shared/lib/html-sanitizer";

function stripHtmlFallback(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractWardrobeDescriptionText(
  description?: string | null,
): string {
  const value = description?.trim();
  if (!value) return "";
  if (!value.includes("<")) return value;

  const sanitized = sanitizeSyncPostHtml(value);
  if (typeof document === "undefined") {
    return stripHtmlFallback(sanitized);
  }

  const container = document.createElement("div");
  container.innerHTML = sanitized;
  return (container.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function getWardrobeMetaDescription(
  description: string | null | undefined,
  fallback: string,
): string {
  const value = stripHtmlFallback(description?.trim() ?? "");
  return value ? value.slice(0, 160) : fallback;
}
