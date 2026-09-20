import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import type { ActiveMember } from '../access/access.types.js';
import { projectMessageDto } from './message-projection.js';
import type { MessageDto } from './message-projection.js';
import { MessagesQueryRepository } from './messages-query.repository.js';

export type MessageWindow = { kind: 'snapshot' | 'history'; from: string } | { kind: 'events'; from: string; high: string };
export type MessagePageItem = {
  readonly id: string; readonly version: string; readonly createdOrder: string; readonly eventOrder: string | null;
} & ({ readonly blocked: true; readonly message: null } | { readonly blocked: false; readonly message: MessageDto });
export interface MessagePage { readonly items: readonly MessagePageItem[]; readonly hasMore: boolean }

@Injectable()
export class MessagesQueryService {
  constructor(@Inject(MessagesQueryRepository) private readonly repository: MessagesQueryRepository) {}

  async page(tx: Transaction, viewer: ActiveMember, window: MessageWindow, limit: number, now?: Date): Promise<MessagePage> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ServiceUnavailableException();
    const rows = await this.repository.page(tx, viewer.id, viewer.room_id, viewer.visible_from_order, window, limit + 1, now ?? await tx.now());
    // The repository applies ACL before LIMIT. Project only the page, never the lookahead
    // row, and never expose source identifiers, grants, SQL rows or storage keys to Sync.
    const items = rows.slice(0, limit).map((row): MessagePageItem => {
      const position = { id: String(row.id), version: String(row.version), createdOrder: String(row.created_order),
        eventOrder: row.event_order === undefined ? null : String(row.event_order) };
      if (Number(row.blocked) === 1) {
        if (window.kind !== 'events') throw new ServiceUnavailableException();
        return { ...position, blocked: true, message: null };
      }
      return { ...position, blocked: false, message: project(row) };
    });
    return { items, hasMore: rows.length > limit };
  }

  async affected(tx: Transaction, viewer: ActiveMember, from: string, high: string, now?: Date): Promise<boolean> {
    return (await this.repository.affected(tx, viewer.room_id, viewer.id, viewer.visible_from_order, from, high, now ?? await tx.now())).length > 0;
  }
  async stickerRevocations(tx: Transaction, viewer: ActiveMember) {
    const rows = await this.repository.stickerRevocations(tx, viewer.room_id, viewer.id, viewer.visible_from_order);
    if (rows.length > 10000) throw new ServiceUnavailableException();
    return rows.map(row => row.id);
  }
}

function project(row: RowDataPacket): MessageDto {
  const kind = row.content_kind as string;
  if (!['TEXT', 'PHOTO', 'VIDEO', 'STICKER'].includes(kind)) throw new ServiceUnavailableException();
  if (kind === 'STICKER' && !row.sticker) throw new ServiceUnavailableException();
  return projectMessageDto({ id: row.id, version: String(row.version), createdAt: row.created_at as Date, audience: row.kind === 'ROOM_SHARED' ? 'SHARED' : 'PRIVATE',
    author: row.deletion_root_id ? { kind: 'anonymous' } : { kind: 'member', actorId: row.sender_member_id, nickname: row.nickname ?? '사용자', avatar: row.avatar_id ? { assetId: row.avatar_id } : null },
    content: kind === 'TEXT' ? { type: 'TEXT', text: row.text_content } : kind === 'STICKER' ? { type: 'STICKER', stickerId: row.sticker.stickerId, assetId: row.sticker.assetId, width: row.sticker.width, height: row.sticker.height } : { type: kind as 'PHOTO' | 'VIDEO', attachments: row.attachments }, quote: !row.deletion_root_id && row.quote_id ? { id: row.quote_id, content: { type: 'TEXT', text: row.quote_text } } : null });
}
