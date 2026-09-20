import type { ChatActorRef, ChatTimelineItem } from './types';
import { uuid } from '../media/contracts';

export type ChatRequest = (path: string, options?: { method?: 'POST' | 'PUT' | 'DELETE'; body?: unknown; signal?: AbortSignal }) => Promise<unknown>;
export interface RoomMembership { roomId: string; name: string; actorId: string; role: 'FAN' | 'STREAMER'; mode: 'FAN' }
export interface ServerMessage {
  id: string; version: string; createdAt: string; audience: 'SHARED' | 'PRIVATE';
  author: { kind: 'anonymous' } | { kind: 'member'; actorId: string; nickname: string };
  content: { type: string; text?: string | null; attachments?: { assetId: string; width: number; height: number; variant: 'image' }[]; stickerId?: string; assetId?: string; width?: number; height?: number };
  quote: { id: string; content: { type: 'TEXT'; text: string } } | null;
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_RESPONSE');
  return value as Record<string, unknown>;
}
export function string(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('INVALID_RESPONSE');
  return value;
}
export function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('INVALID_RESPONSE');
  return value;
}
export function cursor(value: unknown): string | null { return value === null ? null : string(value); }
export function envelope(value: unknown): Record<string, unknown> {
  const data = record(value);
  if (data.schemaVersion !== 1 || typeof data.resetRequired !== 'boolean') throw new Error('INVALID_RESPONSE');
  return data;
}
export function membership(value: unknown): RoomMembership {
  const data = record(value);
  if (data.mode !== 'FAN' || (data.role !== 'FAN' && data.role !== 'STREAMER')) throw new Error('UNSUPPORTED_ROOM');
  return { roomId: string(data.roomId), name: string(data.name), actorId: string(data.actorId), mode: data.mode, role: data.role };
}
export function actor(value: unknown): ChatActorRef | null {
  const data = record(value);
  if (data.role === 'MEMBER') return null;
  if (data.role !== 'FAN' && data.role !== 'STREAMER') throw new Error('INVALID_RESPONSE');
  return { actorId: string(data.actorId), displayName: string(data.nickname), role: data.role, avatarUrl: null };
}
export function message(value: unknown): ServerMessage {
  const data = record(value); const author = record(data.author); const content = record(data.content);
  const id = string(data.id); const version = string(data.version); const createdAt = string(data.createdAt);
  if (!/^\d+$/.test(version) || !Number.isFinite(Date.parse(createdAt)) || !['SHARED', 'PRIVATE'].includes(String(data.audience))) throw new Error('INVALID_RESPONSE');
  if (author.kind !== 'anonymous' && author.kind !== 'member') throw new Error('INVALID_RESPONSE');
  if (author.kind === 'anonymous' && data.audience !== 'SHARED') throw new Error('INVALID_RESPONSE');
  if (content.type === 'TEXT' && content.text !== null && typeof content.text !== 'string') throw new Error('INVALID_RESPONSE');
  let imageContent: ServerMessage['content'] | undefined;
  const dimension = (value: unknown) => { if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 32768) throw new Error('INVALID_RESPONSE'); return Number(value); };
  if (content.type === 'PHOTO') {
    const attachments = list(content.attachments);
    if (attachments.length > 4) throw new Error('INVALID_RESPONSE');
    imageContent = { type: 'PHOTO', attachments: attachments.map(value => {
      const image = record(value);
      if (image.variant !== 'image') throw new Error('INVALID_RESPONSE');
      return { assetId: uuid(image.assetId), width: dimension(image.width), height: dimension(image.height), variant: 'image' };
    }) };
    if (new Set(imageContent.attachments!.map(item => item.assetId)).size !== attachments.length) throw new Error('INVALID_RESPONSE');
  } else if (content.type === 'STICKER') imageContent = { type: 'STICKER', stickerId: uuid(content.stickerId), assetId: uuid(content.assetId), width: dimension(content.width), height: dimension(content.height) };
  let quote: ServerMessage['quote'] = null;
  if (data.quote !== null) {
    const source = record(data.quote); const quoted = record(source.content);
    if (quoted.type !== 'TEXT' || typeof quoted.text !== 'string') throw new Error('INVALID_RESPONSE');
    quote = { id: string(source.id), content: { type: 'TEXT', text: quoted.text } };
  }
  return { id, version, createdAt, audience: data.audience as 'SHARED' | 'PRIVATE',
    author: author.kind === 'anonymous' ? { kind: 'anonymous' } : { kind: 'member', actorId: string(author.actorId), nickname: string(author.nickname) },
    content: imageContent ?? (content.type === 'TEXT' ? { type: 'TEXT', text: content.text as string | null } : { type: string(content.type) }), quote };
}
/** Only server-authorized DTOs enter this projection; missing identities are never guessed. */
export function projectMessages(messages: readonly ServerMessage[], viewerId: string, profiles: readonly ChatActorRef[]): ChatTimelineItem[] {
  return messages.map((item): ChatTimelineItem => {
    const media = item.content.type === 'PHOTO' && item.content.attachments?.length ? { type: 'PHOTO' as const, assets: item.content.attachments }
      : item.content.type === 'STICKER' && item.content.assetId && item.content.stickerId ? { type: 'STICKER' as const, assets: [{ assetId: item.content.assetId, width: item.content.width!, height: item.content.height! }], stickerId: item.content.stickerId } : undefined;
    if (!media && (item.content.type !== 'TEXT' || item.content.text === null || item.content.text === undefined)) return { kind: 'unsupported', id: item.id, scope: item.audience, createdAt: item.createdAt };
    const body = media ? '' : item.content.text!;
    if (item.author.kind === 'anonymous') return { kind: 'publication', id: item.id, body, createdAt: item.createdAt, ...(media ? { media } : {}) };
    const author = item.author;
    return { kind: 'message', id: item.id, scope: item.audience, createdAt: item.createdAt, body, ...(media ? { media } : {}),
      author: { actorId: author.actorId, displayName: author.nickname, avatarUrl: null, role: profiles.find(p => p.actorId === author.actorId)?.role },
      isOwn: author.actorId === viewerId, status: 'saved',
      ...(item.quote ? { quote: { messageId: item.quote.id, authorName: '인용 메시지', excerpt: item.quote.content.text } } : {}) };
  });
}
/** Snapshot/history come in creation order. Updates retain their position, never move to the tail. */
export function mergeMessages(current: readonly ServerMessage[], incoming: readonly ServerMessage[], older = false): ServerMessage[] {
  const versions = new Map(current.map(m => [m.id, m]));
  for (const item of incoming) if (!versions.has(item.id) || BigInt(item.version) > BigInt(versions.get(item.id)!.version)) versions.set(item.id, item);
  const ordered = older ? [...incoming, ...current] : [...current, ...incoming];
  const seen = new Set<string>();
  return ordered.filter(item => !seen.has(item.id) && Boolean(seen.add(item.id))).map(item => versions.get(item.id)!);
}
