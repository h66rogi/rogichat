import emojiRegex from 'emoji-regex';
import { ApiError } from '../../auth/auth-primitives.js';
export function reactionEmoji(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new ApiError('INVALID_REQUEST', 400);
  const emoji = value.normalize('NFC');
  if (!emoji.length || [...emoji].length > 32 || Buffer.byteLength(emoji, 'utf8') > 64) throw new ApiError('INVALID_REQUEST', 400);
  const matches = [...emoji.matchAll(emojiRegex())];
  if (matches.length !== 1 || matches[0]![0] !== emoji) throw new ApiError('INVALID_REQUEST', 400);
  return emoji;
}
