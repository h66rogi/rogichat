import { ApiError, object } from '../../auth/auth-primitives.js';
import { identifier } from '../../../common/validation/identifier.js';

export interface SendInput {
  clientMessageId: string;
  intent: 'SHARED' | 'PRIVATE';
  recipientActorId: string | null;
  quoteId: string | null;
  content: { type: 'TEXT'; text: string } | { type: 'PHOTO' | 'VIDEO' | 'STICKER'; assetIds: string[] };
}

export function sendInput(body: unknown): SendInput {
  const input = object(body, ['clientMessageId', 'intent', 'recipientActorId', 'quoteId', 'content']);
  if (input.intent !== 'SHARED' && input.intent !== 'PRIVATE') throw new ApiError('INVALID_REQUEST', 400);
  if (input.intent === 'SHARED' && input.recipientActorId !== undefined) throw new ApiError('INVALID_REQUEST', 400);
  const content = object(input.content, ['type', 'text']);
  if (content.type !== 'TEXT' || typeof content.text !== 'string') throw new ApiError('INVALID_REQUEST', 400);
  const text = content.text.normalize('NFC');
  if (!text.trim() || [...text].length > 4000 || Buffer.byteLength(text, 'utf8') > 16384 || text.includes(String.fromCharCode(0))) throw new ApiError('INVALID_REQUEST', 400);
  return { clientMessageId: identifier(input.clientMessageId), intent: input.intent,
    recipientActorId: input.intent === 'PRIVATE' ? identifier(input.recipientActorId) : null,
    quoteId: input.quoteId === undefined || input.quoteId === null ? null : identifier(input.quoteId),
    content: { type: 'TEXT', text } };
}
