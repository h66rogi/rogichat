import { isAllowedEmbedDomain } from "@/meloming/shared/constants/embed";

const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "u",
  "s",
  "a",
  "ul",
  "ol",
  "li",
  "blockquote",
  "code",
  "pre",
  "h2",
  "h3",
  "h4",
  "img",
  "video",
  "iframe",
  "span",
  "div",
];

const ALLOWED_ATTR = [
  "href",
  "rel",
  "target",
  "src",
  "alt",
  "width",
  "height",
  "style",
  "allowfullscreen",
  "controls",
  "preload",
  "type",
  "frameborder",
  "allow",
  "referrerpolicy",
  "class",
];

const ALLOWED_CLASSES: Record<string, string[]> = {
  div: ["iframe-wrapper"],
  iframe: ["iframe-embed"],
  video: ["editor-video"],
};

const SAFE_STYLE_PROPERTIES = new Set([
  "color",
  "background-color",
  "font-size",
  "font-family",
  "text-align",
  "display",
]);

const UNSAFE_STYLE_PATTERNS = [
  /expression\s*\(/i,
  /url\s*\(\s*["']?\s*javascript:/i,
  /url\s*\(\s*["']?\s*data:/i,
];

function isSafeStyle(value: string): boolean {
  return !UNSAFE_STYLE_PATTERNS.some((pattern) => pattern.test(value));
}

function filterStyleValue(value: string): string {
  if (!isSafeStyle(value)) return "";
  return value
    .split(";")
    .filter((decl) => {
      const prop = decl.split(":")[0]?.trim().toLowerCase();
      return prop && SAFE_STYLE_PROPERTIES.has(prop);
    })
    .join(";");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);?/g, (_match, code) =>
      String.fromCharCode(Number.parseInt(code, 10)),
    )
    .replace(/&#x([\da-f]+);?/gi, (_match, code) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    )
    .replace(/&colon;/gi, ":")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isBlockedUrl(value: string): boolean {
  const normalized = decodeHtmlEntities(value)
    .replace(/[\u0000-\u001f\u007f\s]+/g, "")
    .toLowerCase();
  return /^(javascript|data|blob|file):/.test(normalized);
}

function sanitizeTagAttributes(tag: string, rawAttributes: string): string | null {
  const attributes = new Map<string, string | null>();
  const attrPattern =
    /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;

  while ((match = attrPattern.exec(rawAttributes))) {
    const name = match[1]?.toLowerCase();
    if (!name || !ALLOWED_ATTR.includes(name) || name.startsWith("on")) {
      continue;
    }

    const rawValue = match[2] ?? match[3] ?? match[4] ?? "";

    if (name === "href") {
      if (!rawValue || isBlockedUrl(rawValue)) continue;
      attributes.set(name, rawValue);
      continue;
    }

    if (name === "src") {
      if (!rawValue || isBlockedUrl(rawValue)) continue;
      if ((tag === "img" || tag === "video") && !rawValue.startsWith("https://")) {
        return null;
      }
      if (tag === "iframe" && !isAllowedEmbedDomain(rawValue)) {
        return null;
      }
      attributes.set(name, rawValue);
      continue;
    }

    if (name === "style") {
      const filtered = filterStyleValue(rawValue);
      if (filtered) attributes.set(name, filtered);
      continue;
    }

    if (name === "class") {
      const allowed = ALLOWED_CLASSES[tag] || [];
      const classes = rawValue
        .split(/\s+/)
        .filter((className) => allowed.includes(className));
      if (classes.length > 0) attributes.set(name, classes.join(" "));
      continue;
    }

    attributes.set(name, rawValue || null);
  }

  if (tag === "a") {
    attributes.set("rel", "noopener noreferrer nofollow");
  }

  if (tag === "iframe") {
    attributes.set("referrerpolicy", "strict-origin-when-cross-origin");
  }

  return Array.from(attributes.entries())
    .map(([name, value]) =>
      value === null ? name : `${name}="${escapeAttribute(value)}"`,
    )
    .join(" ");
}

export function sanitizeSyncPostHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(
      /<\s*(script|style|template|object|embed|link|meta)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
      "",
    )
    .replace(/<\s*(script|style|template|object|embed|link|meta)\b[^>]*\/?\s*>/gi, "")
    .replace(/<\/?([a-zA-Z][\w:-]*)([^<>]*)>/g, (rawTag, rawName, rawAttributes) => {
      const tag = String(rawName).toLowerCase();
      if (!ALLOWED_TAGS.includes(tag)) return "";

      const isClosing = /^<\s*\//.test(rawTag);
      if (isClosing) return `</${tag}>`;

      const attributes = sanitizeTagAttributes(tag, rawAttributes ?? "");
      if (attributes === null) return "";

      const suffix = /\/\s*>$/.test(rawTag) || tag === "br" ? " /" : "";
      return attributes ? `<${tag} ${attributes}${suffix}>` : `<${tag}${suffix}>`;
    });
}
