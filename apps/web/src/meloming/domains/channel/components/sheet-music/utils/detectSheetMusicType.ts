export type SheetMusicType = "PDF" | "IMAGE" | "MUSICXML";

const IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);
const MUSICXML_MIMES = new Set([
  "application/xml",
  "text/xml",
  "application/vnd.recordare.musicxml+xml",
  "application/vnd.recordare.musicxml",
  "application/zip",
]);
const MUSICXML_EXTS = [".musicxml", ".xml", ".mxl"];

export function detectSheetMusicType(
  mime: string,
  fileName: string,
): SheetMusicType | null {
  const m = mime.toLowerCase(); // case-insensitive (matches backend Task 1.1 fix)
  if (m === "image/svg+xml") return null;
  if (m === "application/pdf") return "PDF";
  if (IMAGE_MIMES.has(m)) return "IMAGE";
  if (MUSICXML_MIMES.has(m)) return "MUSICXML";
  // 빈 MIME 도 폴백: macOS 등에서 .musicxml/.mxl 은 OS UTI 매핑이 없어
  // 브라우저가 file.type 으로 빈 문자열을 돌려주는 경우가 흔함.
  if (m === "application/octet-stream" || m === "") {
    const lower = fileName.toLowerCase();
    if (MUSICXML_EXTS.some((ext) => lower.endsWith(ext))) return "MUSICXML";
  }
  return null;
}
