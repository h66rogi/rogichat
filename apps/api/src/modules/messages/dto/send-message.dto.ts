import { parseMembershipScope } from '../../membership-scope/membership-scope.js';
import { ApiError, object } from '../../auth/auth-primitives.js';
import { identifier } from '../../../common/validation/identifier.js';

export interface SendInput {
  membershipScope: string;
  clientMessageId: string;
  intent: 'SHARED' | 'PRIVATE' | 'ROOM_OWNER';
  recipientActorId: string | null;
  quoteId: string | null;
  content: { type: 'TEXT'; text: string } | { type: 'PHOTO' | 'VIDEO'; assetIds: string[]; caption?: string } | { type: 'STICKER'; stickerId: string };
}

export function sendInput(body: unknown): SendInput {
  const input = object(body, ['membershipScope', 'clientMessageId', 'intent', 'recipientActorId', 'quoteId', 'content']);
  if (input.intent !== 'SHARED' && input.intent !== 'PRIVATE' && input.intent !== 'ROOM_OWNER') throw new ApiError('INVALID_REQUEST', 400);
  if (input.intent !== 'PRIVATE' && input.recipientActorId !== undefined) throw new ApiError('INVALID_REQUEST', 400);
  const content = object(input.content, ['type', 'text', 'assetIds', 'stickerId', 'caption']);
  let parsed: SendInput['content'];
  if (content.type === 'TEXT') {
    if (typeof content.text !== 'string' || content.assetIds !== undefined || content.stickerId !== undefined || content.caption !== undefined) throw new ApiError('INVALID_REQUEST', 400);
    const text = content.text.normalize('NFC');
    if (!text.trim() || [...text].length > 4000 || Buffer.byteLength(text, 'utf8') > 16384 || text.includes(String.fromCharCode(0))) throw new ApiError('INVALID_REQUEST', 400);
    parsed = { type: 'TEXT', text };
  } else if (content.type === 'STICKER') {
    if (content.text !== undefined || content.assetIds !== undefined || content.caption !== undefined) throw new ApiError('INVALID_REQUEST', 400);
    parsed = { type: 'STICKER', stickerId: identifier(content.stickerId) };
  } else if (content.type === 'PHOTO' || content.type === 'VIDEO') {
    if (content.text !== undefined || content.stickerId !== undefined || !Array.isArray(content.assetIds) || content.assetIds.length < 1 || content.assetIds.length > (content.type === 'PHOTO' ? 4 : 1)) throw new ApiError('INVALID_REQUEST', 400);
    const assetIds = content.assetIds.map(identifier);
    if (new Set(assetIds).size !== assetIds.length) throw new ApiError('INVALID_REQUEST', 400);
    let caption: string | undefined;
    if (content.caption !== undefined) {
      if (typeof content.caption !== 'string') throw new ApiError('INVALID_REQUEST', 400);
      caption = content.caption.normalize('NFC');
      if (!caption.trim() || [...caption].length > 4000 || Buffer.byteLength(caption, 'utf8') > 16384 || caption.includes(String.fromCharCode(0))) throw new ApiError('INVALID_REQUEST', 400);
    }
    parsed = caption === undefined ? { type: content.type, assetIds } : { type: content.type, assetIds, caption };
  } else throw new ApiError('INVALID_REQUEST', 400);
  return { membershipScope: parseMembershipScope(input.membershipScope), clientMessageId: identifier(input.clientMessageId), intent: input.intent,
    recipientActorId: input.intent === 'PRIVATE' ? identifier(input.recipientActorId) : null,
    quoteId: input.quoteId === undefined || input.quoteId === null ? null : identifier(input.quoteId), content: parsed };
}
