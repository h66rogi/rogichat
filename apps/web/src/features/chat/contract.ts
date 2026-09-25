import type { ChatActorRef, ChatTimelineItem } from './types';
import { reactionSummary, type ReactionSummary } from './reactions';

export type ChatRequest = (path: string, options?: { method?: 'POST' | 'PUT' | 'DELETE'; body?: unknown; signal?: AbortSignal }) => Promise<unknown>;
export interface RoomMembership { roomId: string; name: string; actorId: string; role: 'FAN' | 'STREAMER'; mode: 'FAN'; membershipScope: string; authorizationRevision: string }
export interface ServerMessage {
  id: string; version: string; createdAt: string; audience: 'SHARED' | 'PRIVATE';
  author: { kind: 'anonymous' } | { kind: 'member'; actorId: string; nickname: string; avatar: { assetId: string } | null };
  content: { type: 'TEXT'; text: string | null } | { type: 'PHOTO' | 'VIDEO'; attachments: { assetId: string; width: number; height: number; variant: string }[]; caption?: string } | { type: 'STICKER'; stickerId: string; assetId: string; width: number; height: number };
  quote: { id: string; authorName?: string; content: { type: 'TEXT'; text: string } } | null;
  reactions?: ReactionSummary;
  counterpart: { actorId: string } | null;
  allowedActions: { reply: boolean; publish: boolean; delete: boolean };
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_RESPONSE');
  return value as Record<string, unknown>;
}
export function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  const data = record(value);
  if (required.some(key => !(key in data)) || Object.keys(data).some(key => !required.includes(key) && !optional.includes(key))) throw new Error('INVALID_RESPONSE');
  return data;
}
export function string(value: unknown): string { if (typeof value !== 'string' || !value) throw new Error('INVALID_RESPONSE'); return value; }
export function uuid(value: unknown): string { const result = string(value); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(result)) throw new Error('INVALID_RESPONSE'); return result; }
export function token(value: unknown): string { const result = string(value); if (!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(result)) throw new Error('INVALID_RESPONSE'); return result; }
export function version(value: unknown): string { const result = string(value); if (!/^(0|[1-9][0-9]{0,19})$/.test(result) || BigInt(result) > 18446744073709551615n) throw new Error('INVALID_RESPONSE'); return result; }
export function list(value: unknown): unknown[] { if (!Array.isArray(value)) throw new Error('INVALID_RESPONSE'); return value; }
export function cursor(value: unknown): string | null { if (value === null) return null; const result = string(value); if (result.length > 4096) throw new Error('INVALID_RESPONSE'); return result; }
function bool(value: unknown): boolean { if (typeof value !== 'boolean') throw new Error('INVALID_RESPONSE'); return value; }
function integer(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error('INVALID_RESPONSE'); return value; }
function text(value: unknown): string { if (typeof value !== 'string') throw new Error('INVALID_RESPONSE'); return value; }
function avatar(value: unknown): { assetId: string } | null { return value === null ? null : { assetId: uuid(exact(value, ['assetId']).assetId) }; }
export type SyncKind = 'manifest' | 'snapshot' | 'events' | 'history' | 'profiles';
export function envelope(value: unknown, kind: SyncKind): Record<string, unknown> {
  const fields = kind === 'manifest' ? ['rooms', 'generation', 'complete', 'nextCursor'] : kind === 'profiles' ? ['profiles', 'generation', 'complete', 'nextCursor'] : kind === 'snapshot' ? ['messages', 'nextCursor', 'historyCursor'] : kind === 'events' ? ['events', 'hasMore', 'nextCursor'] : ['messages', 'nextCursor'];
  const data = exact(value, ['schemaVersion', 'resetRequired', ...fields, ...(kind === 'manifest' ? [] : ['membershipScope', 'authorizationRevision'])]);
  if (data.schemaVersion !== 2) throw new Error('INVALID_RESPONSE');
  bool(data.resetRequired); cursor(data.nextCursor);
  const rows = list(data[kind === 'manifest' ? 'rooms' : kind === 'profiles' ? 'profiles' : kind === 'events' ? 'events' : 'messages']);
  if (data.resetRequired) {
    if (kind === 'snapshot' || rows.length || data.nextCursor !== null || (kind !== 'manifest' && (data.membershipScope !== null || data.authorizationRevision !== null)) || ((kind === 'profiles' || kind === 'manifest') && (data.generation !== null || data.complete !== false)) || (kind === 'events' && data.hasMore !== false)) throw new Error('INVALID_RESPONSE');
  } else {
    if (kind !== 'manifest') { token(data.membershipScope); token(data.authorizationRevision); }
    if (kind === 'manifest' || kind === 'profiles') { string(data.generation); if (bool(data.complete) !== (data.nextCursor === null)) throw new Error('INVALID_RESPONSE'); }
    if (kind === 'snapshot') { string(data.nextCursor); cursor(data.historyCursor); }
    if (kind === 'events') { string(data.nextCursor); bool(data.hasMore); rows.forEach(event); }
    if (kind === 'manifest') rows.forEach(manifestRoom);
    if (kind === 'profiles') rows.forEach(actor);
    if (kind === 'snapshot' || kind === 'history') rows.forEach(message);
  }
  return data;
}
function manifestRoom(value: unknown) {
  const data = exact(value, ['roomId', 'name', 'actorId', 'mode', 'role', 'membershipScope', 'authorizationRevision']);
  uuid(data.roomId); text(data.name); uuid(data.actorId); token(data.membershipScope); token(data.authorizationRevision);
  if (!['FAN', 'GROUP'].includes(String(data.mode)) || !['FAN', 'MEMBER', 'STREAMER'].includes(String(data.role))) throw new Error('INVALID_RESPONSE');
  return data;
}
export function membership(value: unknown): RoomMembership {
  const data = manifestRoom(value);
  if (data.mode !== 'FAN' || (data.role !== 'FAN' && data.role !== 'STREAMER')) throw new Error('UNSUPPORTED_ROOM');
  return { roomId: uuid(data.roomId), name: text(data.name), actorId: uuid(data.actorId), mode: data.mode, role: data.role, membershipScope: token(data.membershipScope), authorizationRevision: token(data.authorizationRevision) };
}
export function actor(value: unknown): ChatActorRef | null {
  const data = exact(value, ['actorId', 'nickname', 'role', 'avatar'], ['birthday', 'providerAvatarAvailable']);
  uuid(data.actorId); text(data.nickname); const savedAvatar = avatar(data.avatar);
  if (data.providerAvatarAvailable !== undefined) bool(data.providerAvatarAvailable);
  if (data.birthday !== undefined) { const birthday = exact(data.birthday, ['month', 'day']); const month = integer(birthday.month); const day = integer(birthday.day); if (month < 1 || month > 12 || day < 1 || day > 31) throw new Error('INVALID_RESPONSE'); }
  if (data.role === 'MEMBER') return null;
  if (data.role !== 'FAN' && data.role !== 'STREAMER') throw new Error('INVALID_RESPONSE');
  return { actorId: uuid(data.actorId), displayName: text(data.nickname), role: data.role, avatarUrl: null, ...(savedAvatar ? { avatarAssetId: savedAvatar.assetId } : {}), ...(data.providerAvatarAvailable === true ? { providerAvatarAvailable: true } : {}) };
}
export function message(value: unknown): ServerMessage {
  const data = exact(value, ['id', 'version', 'createdAt', 'audience', 'author', 'content', 'quote', 'counterpart', 'allowedActions'], ['reactions']);
  const author = record(data.author); const content = record(data.content);
  const createdAt = string(data.createdAt);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(createdAt) || !Number.isFinite(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt || !['SHARED', 'PRIVATE'].includes(String(data.audience))) throw new Error('INVALID_RESPONSE');
  let parsedAuthor: ServerMessage['author'];
  if (author.kind === 'anonymous') { exact(author, ['kind']); if (data.audience !== 'SHARED' || data.counterpart !== null || data.quote !== null) throw new Error('INVALID_RESPONSE'); parsedAuthor = { kind: 'anonymous' }; }
  else { exact(author, ['kind', 'actorId', 'nickname', 'avatar']); if (author.kind !== 'member') throw new Error('INVALID_RESPONSE'); parsedAuthor = { kind: 'member', actorId: uuid(author.actorId), nickname: text(author.nickname), avatar: avatar(author.avatar) }; }
  let parsedContent: ServerMessage['content'];
  if (content.type === 'TEXT') { exact(content, ['type', 'text']); parsedContent = { type: 'TEXT', text: content.text === null ? null : text(content.text) }; }
  else if (content.type === 'PHOTO' || content.type === 'VIDEO') {
    exact(content, ['type', 'attachments'], ['caption']);
    const caption = content.caption === undefined ? undefined : text(content.caption);
    if (caption !== undefined && (!caption.trim() || [...caption].length > 4000 || new TextEncoder().encode(caption).length > 16384 || caption.includes('\0'))) throw new Error('INVALID_RESPONSE');
    parsedContent = { type: content.type, attachments: list(content.attachments).map(value => { const a = exact(value, ['assetId', 'width', 'height', 'variant']); return { assetId: uuid(a.assetId), width: integer(a.width), height: integer(a.height), variant: text(a.variant) }; }), ...(caption === undefined ? {} : { caption }) };
  }
  else { exact(content, ['type', 'stickerId', 'assetId', 'width', 'height']); if (content.type !== 'STICKER') throw new Error('INVALID_RESPONSE'); parsedContent = { type: 'STICKER', stickerId: uuid(content.stickerId), assetId: uuid(content.assetId), width: integer(content.width), height: integer(content.height) }; }
  let quote: ServerMessage['quote'] = null;
  if (data.quote !== null) { const source = exact(data.quote, ['id', 'content'], ['authorName']); const quoted = exact(source.content, ['type', 'text']); if (quoted.type !== 'TEXT') throw new Error('INVALID_RESPONSE'); quote = { id: uuid(source.id), ...(source.authorName === undefined ? {} : { authorName: text(source.authorName) }), content: { type: 'TEXT', text: text(quoted.text) } }; }
  const counterpart = data.counterpart === null ? null : { actorId: uuid(exact(data.counterpart, ['actorId']).actorId) };
  if (data.audience === 'SHARED' && counterpart !== null) throw new Error('INVALID_RESPONSE');
  const actions = exact(data.allowedActions, ['reply', 'publish', 'delete']);
  return { id: uuid(data.id), version: version(data.version), createdAt, audience: data.audience as 'SHARED' | 'PRIVATE', author: parsedAuthor, content: parsedContent, quote, counterpart, ...(data.reactions === undefined ? {} : { reactions: reactionSummary(data.reactions) }), allowedActions: { reply: bool(actions.reply), publish: bool(actions.publish), delete: bool(actions.delete) } };
}
export type MessageEvent = { type: 'message.upsert'; message: ServerMessage } | { type: 'message.deleted'; messageId: string; version: string };
export function event(value: unknown): MessageEvent { const data = record(value); if (data.type === 'message.deleted') { exact(data, ['type', 'messageId', 'version']); return { type: 'message.deleted', messageId: uuid(data.messageId), version: version(data.version) }; } exact(data, ['type', 'message']); if (data.type !== 'message.upsert') throw new Error('INVALID_RESPONSE'); return { type: 'message.upsert', message: message(data.message) }; }
export type Receipt = { clientMessageId: string; status: 'committed'; messageId: string; version: string } | { clientMessageId: string; status: 'deleted' };
/** GET deleted receipts deliberately differ from legacy SEND deleted acknowledgements. */
export function receipt(value: unknown, expected: string, transport: 'lookup' | 'send'): Receipt {
  const data = record(value);
  if (data.clientMessageId !== expected) throw new Error('INVALID_RESPONSE'); uuid(data.clientMessageId);
  if (data.status === 'deleted') { exact(data, ['clientMessageId', 'status', ...(transport === 'send' ? ['messageId'] : [])]); if (transport === 'send') uuid(data.messageId); return { clientMessageId: expected, status: 'deleted' }; }
  exact(data, ['clientMessageId', 'status', 'messageId', 'version']); if (data.status !== 'committed') throw new Error('INVALID_RESPONSE');
  return { clientMessageId: expected, status: 'committed', messageId: uuid(data.messageId), version: version(data.version) };
}
export function projectMessages(messages: readonly ServerMessage[], viewerId: string, profiles: readonly ChatActorRef[]): ChatTimelineItem[] {
  return messages.map((item): ChatTimelineItem => {
    const content = item.content;
    const media = content.type === 'PHOTO' && content.attachments.length > 0 && content.attachments.length <= 4 && content.attachments.every(a => a.variant === 'image' && a.width > 0 && a.height > 0)
      ? { type: 'PHOTO' as const, revision: item.version, assets: content.attachments }
      : content.type === 'VIDEO' && content.attachments.length === 2 && new Set(content.attachments.map(a => a.assetId)).size === 1 && new Set(content.attachments.map(a => a.variant)).size === 2 && content.attachments.every(a => ['video', 'poster'].includes(a.variant) && a.width > 0 && a.height > 0)
        ? { type: 'VIDEO' as const, revision: item.version, assets: content.attachments }
      : content.type === 'STICKER' ? { type: 'STICKER' as const, revision: item.version, assets: [{ assetId: content.assetId, width: content.width, height: content.height }], stickerId: content.stickerId } : undefined;
    if (!media && (content.type !== 'TEXT' || content.text === null)) return { kind: 'unsupported', id: item.id, scope: item.audience, createdAt: item.createdAt, allowedActions: item.allowedActions };
    const body = content.type === 'TEXT' ? content.text! : content.type === 'STICKER' ? '' : content.caption ?? '';
    if (item.author.kind === 'anonymous') return { kind: 'publication', id: item.id, body, createdAt: item.createdAt, allowedActions: item.allowedActions, ...(item.reactions ? { reactions: item.reactions } : {}), ...(media ? { media } : {}) };
    const author = item.author;
    const recipient = profiles.find(p => p.actorId === item.counterpart?.actorId);
    return { kind: 'message', id: item.id, scope: item.audience, createdAt: item.createdAt, body, allowedActions: item.allowedActions, ...(item.reactions ? { reactions: item.reactions } : {}), ...(media ? { media } : {}),
      ...(recipient ? { recipient } : {}), counterpartActorId: item.counterpart?.actorId ?? null,
      author: { actorId: author.actorId, displayName: author.nickname, avatarUrl: null, ...(author.avatar ? { avatarAssetId: author.avatar.assetId } : {}), ...(profiles.find(p => p.actorId === author.actorId)?.providerAvatarAvailable ? { providerAvatarAvailable: true } : {}), role: profiles.find(p => p.actorId === author.actorId)?.role }, isOwn: author.actorId === viewerId, status: 'saved',
      ...(item.quote ? { quote: { messageId: item.quote.id, authorName: item.quote.authorName ?? '사용자', excerpt: item.quote.content.text } } : {}) };
  });
}
export const displayOrder = (a: ServerMessage, b: ServerMessage): number => a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
export function mergeMessages(current: readonly ServerMessage[], incoming: readonly ServerMessage[]): ServerMessage[] {
  const versions = new Map(current.map(m => [m.id, m]));
  for (const item of incoming) { const prior = versions.get(item.id); if (prior && prior.createdAt !== item.createdAt) throw new Error('IMMUTABLE_DISPLAY_KEY'); if (!prior || BigInt(item.version) >= BigInt(prior.version)) versions.set(item.id, item); }
  return [...versions.values()].sort(displayOrder);
}
