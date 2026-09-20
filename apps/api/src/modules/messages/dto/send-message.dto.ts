import { ApiError, object } from '../../auth/auth-primitives.js';
import { identifier } from '../../../common/validation/identifier.js';

export interface SendInput {
  clientMessageId: string;
  intent: 'SHARED' | 'PRIVATE';
  recipientActorId: string | null;
  quoteId: string | null;
  content: { type: 'TEXT'; text: string } | { type: 'PHOTO' | 'VIDEO'; assetIds: string[] } | { type: 'STICKER'; stickerId: string };
}

export function sendInput(body: unknown): SendInput {
  const input = object(body, ['clientMessageId', 'intent', 'recipientActorId', 'quoteId', 'content']);
  if (input.intent !== 'SHARED' && input.intent !== 'PRIVATE') throw new ApiError('INVALID_REQUEST', 400);
  if (input.intent === 'SHARED' && input.recipientActorId !== undefined) throw new ApiError('INVALID_REQUEST', 400);
  const content = object(input.content, ['type', 'text', 'assetIds', 'stickerId']);
  let parsed: SendInput['content'];
  if (content.type === 'TEXT') {
    if (typeof content.text !== 'string' || content.assetIds !== undefined || content.stickerId !== undefined) throw new ApiError('INVALID_REQUEST', 400);
    const text = content.text.normalize('NFC');
    if (!text.trim() || [...text].length > 4000 || Buffer.byteLength(text, 'utf8') > 16384 || text.includes(String.fromCharCode(0))) throw new ApiError('INVALID_REQUEST', 400);
    parsed = { type: 'TEXT', text };
  } else if (content.type === 'STICKER') {
    if (content.text !== undefined || content.assetIds !== undefined) throw new ApiError('INVALID_REQUEST', 400);
    parsed = { type: 'STICKER', stickerId: identifier(content.stickerId) };
  } else if (content.type === 'PHOTO' || content.type === 'VIDEO') {
    if (content.text !== undefined || content.stickerId !== undefined || !Array.isArray(content.assetIds) || content.assetIds.length < 1 || content.assetIds.length > (content.type === 'PHOTO' ? 4 : 1)) throw new ApiError('INVALID_REQUEST', 400);
    const assetIds = content.assetIds.map(identifier);
    if (new Set(assetIds).size !== assetIds.length) throw new ApiError('INVALID_REQUEST', 400);
    parsed = { type: content.type, assetIds };
  } else throw new ApiError('INVALID_REQUEST', 400);
  return { clientMessageId: identifier(input.clientMessageId), intent: input.intent,
    recipientActorId: input.intent === 'PRIVATE' ? identifier(input.recipientActorId) : null,
    quoteId: input.quoteId === undefined || input.quoteId === null ? null : identifier(input.quoteId), content: parsed };
}
