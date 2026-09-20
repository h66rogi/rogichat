// Wire contract pinned in docs/web-media-integration.md. No runtime fixtures.
export type ImageKind = 'PHOTO' | 'AVATAR' | 'STICKER';
export type MediaStatus = 'reserved' | 'uploading' | 'processing' | 'ready' | 'deleting' | 'deleted';
export interface Receipt { readonly assetId: string; readonly status: MediaStatus }
export interface UploadInput { readonly kind: ImageKind; readonly contentType: string; readonly byteLength: number; readonly roomId?: string }
export type ImageContext =
  | { readonly variant: 'image'; readonly roomId?: never; readonly messageId?: never; readonly actorId?: never; readonly stickerId?: never }
  | { readonly variant: 'image'; readonly roomId: string; readonly messageId: string; readonly actorId?: never; readonly stickerId?: string }
  | { readonly variant: 'image'; readonly roomId: string; readonly actorId: string; readonly messageId?: never; readonly stickerId?: never }
  | { readonly variant: 'image'; readonly roomId: string; readonly stickerId: string; readonly messageId?: never; readonly actorId?: never };
export interface Sticker { readonly id: string; readonly assetId: string; readonly label: string }
export interface StickerPage { readonly items: readonly Sticker[]; readonly nextCursor: string | null }
// Abort synchronously on identity, membership, message deletion or sticker revocation.
// isCurrent also fences transports which resolve after abort and render-time races.
export interface MediaLifetime { readonly signal: AbortSignal; readonly isCurrent: () => boolean }
export class MediaError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 0) { super(code); this.code = code; this.status = status; }
}
export function current(lifetime: MediaLifetime): void {
  if (lifetime.signal.aborted || !lifetime.isCurrent()) throw new MediaError('REVOKED');
}
export function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new MediaError('INVALID_RESPONSE');
  return value as Record<string, unknown>;
}
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)) throw new MediaError('INVALID_IDENTIFIER');
  return value;
}
export function receipt(value: unknown, expectedId?: string): Receipt {
  const row = record(value, ['assetId', 'status']);
  const assetId = uuid(row.assetId);
  if ((expectedId !== undefined && expectedId !== assetId) || typeof row.status !== 'string' || !['reserved', 'uploading', 'processing', 'ready', 'deleting', 'deleted'].includes(row.status)) throw new MediaError('INVALID_RESPONSE');
  return Object.freeze({ assetId, status: row.status as MediaStatus });
}
export function uploadInput(kind: ImageKind, file: Blob, roomId?: string): UploadInput {
  const allowed = kind === 'STICKER' ? ['image/png', 'image/webp'] : ['image/jpeg', 'image/png', 'image/webp'];
  if (!['PHOTO', 'AVATAR', 'STICKER'].includes(kind) || !allowed.includes(file.type) || file.size < 1 || file.size > (kind === 'STICKER' ? 1 : 10) * 1024 * 1024) throw new MediaError('INVALID_FILE');
  if (kind === 'PHOTO') return Object.freeze({ kind, contentType: file.type, byteLength: file.size, roomId: uuid(roomId) });
  if (roomId !== undefined) throw new MediaError('INVALID_CONTEXT');
  return Object.freeze({ kind, contentType: file.type, byteLength: file.size });
}
export function imageContext(value: ImageContext): ImageContext {
  const row = record(value, ['variant', 'roomId', 'messageId', 'actorId', 'stickerId']);
  if (row.variant !== 'image') throw new MediaError('INVALID_CONTEXT');
  for (const key of ['roomId', 'messageId', 'actorId', 'stickerId']) if (row[key] !== undefined) uuid(row[key]);
  if (row.actorId !== undefined && (row.messageId !== undefined || row.stickerId !== undefined)) throw new MediaError('INVALID_CONTEXT');
  const hasReference = row.actorId !== undefined || row.messageId !== undefined || row.stickerId !== undefined;
  if ((row.roomId !== undefined) !== hasReference) throw new MediaError('INVALID_CONTEXT');
  return Object.freeze({ ...value });
}
export function imageReferenceKey(assetId: string, context: ImageContext): string {
  return JSON.stringify([assetId, context.roomId, context.messageId, context.actorId, context.stickerId]);
}
export function stickerPage(value: unknown): StickerPage {
  const row = record(value, ['items', 'nextCursor']);
  if (!Array.isArray(row.items) || row.items.length > 50) throw new MediaError('INVALID_RESPONSE');
  const items = row.items.map(value => {
    const item = record(value, ['id', 'assetId', 'label']);
    if (typeof item.label !== 'string' || !item.label || [...item.label].length > 64) throw new MediaError('INVALID_RESPONSE');
    return Object.freeze({ id: uuid(item.id), assetId: uuid(item.assetId), label: item.label });
  });
  if (new Set(items.map(item => item.id)).size !== items.length) throw new MediaError('INVALID_RESPONSE');
  return Object.freeze({ items: Object.freeze(items), nextCursor: row.nextCursor === null ? null : uuid(row.nextCursor) });
}
