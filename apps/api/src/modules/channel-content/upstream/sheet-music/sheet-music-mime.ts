export type SheetMusicType = 'PDF' | 'IMAGE' | 'MUSICXML';

const ALLOWED_MIME_EXACT: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/xml',
  'text/xml',
  'application/vnd.recordare.musicxml+xml',
  'application/vnd.recordare.musicxml',
  'application/zip',
]);

const MUSICXML_EXTS = ['.musicxml', '.xml', '.mxl'];

export function isAllowedMime(mime: string, fileName: string): boolean {
  const m = mime.toLowerCase();
  if (m === 'image/svg+xml') return false;
  if (ALLOWED_MIME_EXACT.has(m)) return true;
  if (m === 'application/octet-stream') {
    const lower = fileName.toLowerCase();
    return MUSICXML_EXTS.some((ext) => lower.endsWith(ext));
  }
  return false;
}

const MAGIC_PDF = Buffer.from([0x25, 0x50, 0x44, 0x46]);
const MAGIC_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAGIC_JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const MAGIC_RIFF = Buffer.from('RIFF', 'utf-8');
const MAGIC_WEBP_TAG = Buffer.from('WEBP', 'utf-8');
const MAGIC_ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

function startsWith(buf: Buffer, magic: Buffer): boolean {
  if (buf.length < magic.length) return false;
  return buf.subarray(0, magic.length).equals(magic);
}

function isWebP(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  return (
    startsWith(buf, MAGIC_RIFF) && buf.subarray(8, 12).equals(MAGIC_WEBP_TAG)
  );
}

/**
 * Verify a buffer begins with a MusicXML root element (`<score-partwise>` or
 * `<score-timewise>`). The first 1 KiB is sampled, XML declarations and
 * whitespace are tolerated. Exported because `mxl-extractor` also re-validates
 * the extracted payload (Round 4 H4) — without this check, an .mxl zip whose
 * .xml entry contains arbitrary XML (SVG, HTML-in-XML) could slip through the
 * upload pipeline after the outer ZIP-magic check.
 */
export function isMusicXmlLike(buf: Buffer): boolean {
  const head = buf
    .subarray(0, Math.min(buf.length, 1024))
    .toString('utf-8')
    .trimStart();
  if (!head.startsWith('<')) return false;
  return /<score-(partwise|timewise)\b/.test(head);
}

export function detectSheetMusicType(
  mime: string,
  fileName: string,
  fileHead: Buffer,
): SheetMusicType | null {
  const m = mime.toLowerCase();
  if (!isAllowedMime(m, fileName)) return null;

  if (m === 'application/pdf') {
    return startsWith(fileHead, MAGIC_PDF) ? 'PDF' : null;
  }
  if (m === 'image/png')
    return startsWith(fileHead, MAGIC_PNG) ? 'IMAGE' : null;
  if (m === 'image/jpeg' || m === 'image/jpg')
    return startsWith(fileHead, MAGIC_JPEG) ? 'IMAGE' : null;
  if (m === 'image/webp') return isWebP(fileHead) ? 'IMAGE' : null;

  if (
    m === 'application/zip' ||
    (m === 'application/octet-stream' &&
      fileName.toLowerCase().endsWith('.mxl'))
  ) {
    return startsWith(fileHead, MAGIC_ZIP) ? 'MUSICXML' : null;
  }
  if (
    m === 'application/xml' ||
    m === 'text/xml' ||
    m === 'application/vnd.recordare.musicxml+xml' ||
    m === 'application/vnd.recordare.musicxml' ||
    (m === 'application/octet-stream' &&
      (fileName.toLowerCase().endsWith('.musicxml') ||
        fileName.toLowerCase().endsWith('.xml')))
  ) {
    return isMusicXmlLike(fileHead) ? 'MUSICXML' : null;
  }
  return null;
}
