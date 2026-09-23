import sanitizeHtml from 'sanitize-html';
import { isAllowedEmbedDomain } from './embed.js';

const ALLOWED_CLASSES = ['iframe-wrapper', 'iframe-embed'];

const SAFE_STYLE_PROPERTIES = [
  'color',
  'background-color',
  'font-size',
  'font-family',
  'text-align',
  'display',
];

const UNSAFE_STYLE_PATTERNS = [
  /expression\s*\(/i,
  /url\s*\(\s*["']?\s*javascript:/i,
  /url\s*\(\s*["']?\s*data:/i,
];

function isDeclarationSafe(decl: string): boolean {
  return !UNSAFE_STYLE_PATTERNS.some((pattern) => pattern.test(decl));
}

function filterStyle(value: string): string {
  const declarations = value.split(';').filter(Boolean);
  const safe = declarations.filter((decl) => {
    const prop = decl.split(':')[0]?.trim().toLowerCase();
    return (
      prop && SAFE_STYLE_PROPERTIES.includes(prop) && isDeclarationSafe(decl)
    );
  });
  return safe.join(';');
}

export function sanitizeSyncPostHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p',
      'br',
      'strong',
      'em',
      'u',
      's',
      'a',
      'ul',
      'ol',
      'li',
      'blockquote',
      'code',
      'pre',
      'h2',
      'h3',
      'h4',
      'img',
      'iframe',
      'span',
      'div',
    ],
    allowedAttributes: {
      a: ['href', 'rel', 'target'],
      img: ['src', 'alt', 'width', 'height', 'style'],
      iframe: [
        'src',
        'width',
        'height',
        'allowfullscreen',
        'frameborder',
        'allow',
        'class',
      ],
      div: ['class', 'style'],
      span: ['style'],
      '*': [],
    },
    allowedClasses: {
      div: ALLOWED_CLASSES,
      iframe: ALLOWED_CLASSES,
    },
    allowedSchemes: ['https', 'mailto'],
    allowedSchemesByTag: {
      a: ['https', 'http', 'mailto'],
      img: ['https'],
      iframe: ['https'],
    },
    transformTags: {
      a: (tagName, attribs) => {
        const href = attribs.href || '';
        if (
          href.startsWith('javascript:') ||
          href.startsWith('data:') ||
          href.startsWith('blob:') ||
          href.startsWith('file:')
        ) {
          return { tagName, attribs: {} };
        }
        return {
          tagName,
          attribs: {
            ...attribs,
            rel: 'noopener noreferrer nofollow',
          },
        };
      },
      img: (tagName, attribs) => {
        const src = attribs.src || '';
        if (!src.startsWith('https://')) {
          return { tagName: '', attribs: {} };
        }
        const { style: rawStyle, ...rest } = attribs;
        const style = rawStyle ? filterStyle(rawStyle) : '';
        return {
          tagName,
          attribs: {
            ...rest,
            ...(style ? { style } : {}),
          },
        };
      },
      iframe: (tagName, attribs) => {
        const src = attribs.src || '';
        if (!isAllowedEmbedDomain(src)) {
          return { tagName: '', attribs: {} };
        }
        return { tagName, attribs };
      },
      div: (tagName, attribs) => {
        const { style: rawStyle, ...rest } = attribs;
        const style = rawStyle ? filterStyle(rawStyle) : '';
        return {
          tagName,
          attribs: {
            ...rest,
            ...(style ? { style } : {}),
          },
        };
      },
      span: (tagName, attribs) => {
        const style = attribs.style ? filterStyle(attribs.style) : '';
        return {
          tagName,
          attribs: {
            ...(style ? { style } : {}),
          },
        };
      },
    },
  });
}
