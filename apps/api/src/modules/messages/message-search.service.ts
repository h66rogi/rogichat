import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import { ApiError } from '../auth/auth-primitives.js';
import { AuthService } from '../auth/auth.service.js';
import type { SessionCredentials } from '../auth/auth-context.js';
import { identifier } from '../../common/validation/identifier.js';
import { MessageSearchRepository } from './message-search.repository.js';

function cursor(value: unknown): { at: Date; id: string } | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > 160 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new ApiError('INVALID_REQUEST', 400);
  const decoded = Buffer.from(value, 'base64url').toString('utf8');
  if (Buffer.from(decoded).toString('base64url') !== value) throw new ApiError('INVALID_REQUEST', 400);
  const [at, id, extra] = decoded.split('|');
  const date = new Date(at ?? '');
  if (extra !== undefined || !at || !Number.isFinite(date.getTime()) || date.toISOString() !== at) throw new ApiError('INVALID_REQUEST', 400);
  return { at: date, id: identifier(id) };
}
const encode = (at: Date, id: string) => Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
const escapeLike = (value: string) => value.replaceAll('!', '!!').replaceAll('%', '!%').replaceAll('_', '!_');

@Injectable()
export class MessageSearchService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(MessageSearchRepository) private readonly repository: MessageSearchRepository) {}

  search(credentials: SessionCredentials, rawQuery: unknown, rawCursor: unknown) {
    if (typeof rawQuery !== 'string') throw new ApiError('INVALID_REQUEST', 400);
    const query = rawQuery.trim();
    if (query.length < 2 || query.length > 100 || [...query].some(character => character.charCodeAt(0) < 32)) throw new ApiError('INVALID_REQUEST', 400);
    const before = cursor(rawCursor);
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const rows = await this.repository.page(tx, actor.userId, `%${escapeLike(query)}%`, 30, before);
      const items = rows.slice(0, 30).map(row => ({
        messageId: row.id, roomId: row.room_id, roomName: row.room_name,
        createdAt: row.created_at.toISOString(),
        author: row.deletion_root_id ? '익명' : row.nickname ?? '사용자',
        excerpt: row.text_content.slice(0, 400),
      }));
      return { items, nextCursor: rows.length > 30 ? encode(rows[29]!.created_at, rows[29]!.id) : null };
    });
  }
}
