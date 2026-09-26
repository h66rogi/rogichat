import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import { identifier } from '../../common/validation/identifier.js';
import { ApiError } from '../auth/auth-primitives.js';
import { AuthService } from '../auth/auth.service.js';
import { requireCommandProof } from '../auth/auth-context.js';
import type { CommandCredentials, SessionCredentials } from '../auth/auth-context.js';
import { NotificationInboxRepository } from './notification-inbox.repository.js';

const cursorOf = (createdAt: Date, id: string) => Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
function parseCursor(value: unknown): { createdAt: Date; id: string } | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > 160 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new ApiError('INVALID_REQUEST', 400);
  const text = Buffer.from(value, 'base64url').toString('utf8');
  if (Buffer.from(text).toString('base64url') !== value) throw new ApiError('INVALID_REQUEST', 400);
  const parts = text.split('|');
  if (parts.length !== 2 || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(parts[0]!)) throw new ApiError('INVALID_REQUEST', 400);
  const createdAt = new Date(parts[0]!);
  if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== parts[0]) throw new ApiError('INVALID_REQUEST', 400);
  return { createdAt, id: identifier(parts[1]) };
}

@Injectable()
export class NotificationInboxService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(NotificationInboxRepository) private readonly repository: NotificationInboxRepository) {}

  page(credentials: SessionCredentials, rawLimit: unknown, rawCursor: unknown) {
    const limit = rawLimit === undefined ? 20 : Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || (rawLimit !== undefined && (typeof rawLimit !== 'string' || !/^[1-9][0-9]?$/.test(rawLimit)))) throw new ApiError('INVALID_REQUEST', 400);
    const cursor = parseCursor(rawCursor);
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const rows = await this.repository.page(tx, actor.userId, limit, cursor);
      const items = rows.slice(0, limit).map(row => ({
        id: row.id, type: 'MESSAGE' as const, title: row.room_name,
        body: '새 메시지가 도착했어요', url: '/chat', roomId: row.room_id,
        readAt: row.read_at?.toISOString() ?? null, createdAt: row.created_at.toISOString(),
      }));
      return { items, nextCursor: rows.length > limit && items.length ? cursorOf(rows[limit - 1]!.created_at, rows[limit - 1]!.id) : null,
        hasNextPage: rows.length > limit };
    });
  }

  markRead(credentials: CommandCredentials, rawId: unknown): Promise<void> {
    const id = identifier(rawId); requireCommandProof(credentials);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const message = await this.repository.visible(tx, actor.userId, id);
      if (!message) throw new ApiError('NOT_FOUND', 404);
      await this.repository.markRead(tx, actor.userId, message.room_id, id);
    });
  }
}
