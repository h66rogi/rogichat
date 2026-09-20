/**
 * Pure date/text helpers for the chat timeline.
 *
 * Adapted from meloming-front 8db1289e6ce5b2b37028ddbb73863363870de6b5
 * src/domains/talk/components/room/TalkMessageList.tsx (isSameDay, formatDateLabel) and
 * TalkMessageBubble.tsx (formatTime, truncate). Changes: explicit `now` parameter for
 * deterministic tests, invalid-date guard, shared excerpt length constant.
 */

export const QUOTE_EXCERPT_MAX = 60;

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function parseIsoDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "오늘", "어제", or a full Korean date such as "2026년 9월 20일". */
export function formatDateLabel(date: Date, now: Date = new Date()): string {
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  if (isSameDay(date, now)) return '오늘';
  if (isSameDay(date, yesterday)) return '어제';
  return date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** "오후 3:07" style time label. */
export function formatTimeLabel(date: Date): string {
  return date.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
}

/** Cut a single-line excerpt for quotes and previews. Collapses line breaks first. */
export function truncateExcerpt(text: string, maxLength: number = QUOTE_EXCERPT_MAX): string {
  const singleLine = text.replace(/\s*\n+\s*/g, ' ').trim();
  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, maxLength)}…`;
}
