import { exact, uuid } from '../chat/contract';
export const REPORT_REASONS = ['spam', 'harassment', 'sexual', 'violence', 'other'] as const;
export type ReportReason = typeof REPORT_REASONS[number];
export interface ReportInput { idempotencyKey: string; reason: ReportReason; detail?: string }
export interface ReportReceipt { reportId: string; status: 'received' | 'resolved' | 'dismissed'; createdAt: string }
export interface BlockReceipt { actorId: string; blocked: boolean; resetRequired: true }
export interface BlockPage { blocks: { actorId: string; blockedAt: string; displayName: string | null }[]; next: string | null }
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('INVALID_RESPONSE');
  return value;
}
export function reportInput(value: ReportInput): ReportInput {
  const data = exact(value, ['idempotencyKey', 'reason'], ['detail']); uuid(data.idempotencyKey);
  if (!REPORT_REASONS.includes(data.reason as ReportReason) || ('detail' in data && (typeof data.detail !== 'string' || data.detail.length < 1 || [...data.detail].length > 1000 || [...data.detail].some(char => { const code = char.charCodeAt(0); return code < 32 && ![9, 10, 13].includes(code); })))) throw new Error('INVALID_INPUT');
  return { idempotencyKey: value.idempotencyKey, reason: value.reason, ...(value.detail === undefined ? {} : { detail: value.detail }) };
}
export function reportReceipt(value: unknown): ReportReceipt {
  const data = exact(value, ['reportId', 'status', 'createdAt']);
  if (!['received', 'resolved', 'dismissed'].includes(String(data.status))) throw new Error('INVALID_RESPONSE');
  return { reportId: uuid(data.reportId), status: data.status as ReportReceipt['status'], createdAt: timestamp(data.createdAt) };
}
export function blockReceipt(value: unknown, actorId: string, blocked: boolean): BlockReceipt {
  const data = exact(value, ['actorId', 'blocked', 'resetRequired']);
  if (uuid(data.actorId) !== actorId || data.blocked !== blocked || data.resetRequired !== true) throw new Error('INVALID_RESPONSE');
  return { actorId, blocked, resetRequired: true };
}
export function blockPage(value: unknown): BlockPage {
  const data = exact(value, ['blocks', 'next']);
  if (!Array.isArray(data.blocks) || data.blocks.length > 50) throw new Error('INVALID_RESPONSE');
  const blocks = data.blocks.map(value => {
    const row = exact(value, ['actorId', 'blockedAt', 'displayName']);
    if (row.displayName !== null && typeof row.displayName !== 'string') throw new Error('INVALID_RESPONSE');
    return { actorId: uuid(row.actorId), blockedAt: timestamp(row.blockedAt), displayName: row.displayName };
  });
  if (new Set(blocks.map(row => row.actorId)).size !== blocks.length) throw new Error('INVALID_RESPONSE');
  const next = data.next === null ? null : uuid(data.next);
  if (next && (!blocks.length || next !== blocks.at(-1)?.actorId)) throw new Error('INVALID_RESPONSE');
  return { blocks, next };
}
