import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { identifier } from '../../common/validation/identifier.js';
import { ApiError } from '../auth/auth-primitives.js';
import { AccessService } from '../access/access.service.js';
import type { ActiveMember } from '../access/access.types.js';
import { MessagesCoreService } from '../messages/messages-core.service.js';
import { readContext, requireReadContext } from './read-context.js';
import type { ReadContextBinding } from './read-context.js';
import { ReadStateRepository } from './read-state.repository.js';
import type { OwnReadStateDto, OwnReadStatesDto, ReadStateInput } from './dto/read-state.dto.js';

@Injectable()
export class ReadStateCoreService {
  constructor(@Inject(ReadStateRepository) private readonly repository: ReadStateRepository,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(MessagesCoreService) private readonly messages: MessagesCoreService) {}

  private async project(tx: Transaction, viewer: ActiveMember, streamId: string, order: bigint): Promise<OwnReadStateDto> {
    const candidate = await this.repository.messageAt(tx, viewer.room_id, streamId, order);
    if (!candidate) return { messageId: null };
    const message = await this.messages.load(tx, viewer.room_id, candidate.id);
    if (!message || message.stream_id !== streamId || BigInt(message.created_order) !== order ||
        !await this.messages.readable(tx, viewer, message)) return { messageId: null };
    return { messageId: message.id };
  }

  // The caller authenticates current session/account/SOOP on this transaction.
  async get(tx: Transaction, roomId: string, userId: string, binding: ReadContextBinding): Promise<OwnReadStatesDto> {
    const viewer = await this.access.requireActiveMember(tx, identifier(roomId), userId);
    const items: OwnReadStateDto[] = [];
    const rows = await this.repository.recent(tx, viewer);
    for (const row of rows) {
      const item = await this.project(tx, viewer, row.stream_id, row.last_read_order);
      if (item.messageId !== null) items.push(item);
    }
    return { readContext: readContext(viewer, binding), items };
  }

  async put(tx: Transaction, roomId: string, userId: string, input: ReadStateInput, binding: ReadContextBinding): Promise<OwnReadStateDto> {
    if (!tx.writable) throw new Error('transaction_not_writable');
    identifier(roomId); identifier(input.messageId);
    if (!await this.repository.lockRoom(tx, roomId)) throw new ApiError('NOT_FOUND', 404);
    const viewer = await this.access.requireActiveMember(tx, roomId, userId);
    requireReadContext(input.readContext, viewer, binding);
    const message = await this.messages.load(tx, roomId, input.messageId);
    if (!message || !await this.messages.readable(tx, viewer, message)) throw new ApiError('NOT_FOUND', 404);
    await this.repository.advance(tx, viewer, message.stream_id, BigInt(message.created_order));
    const state = await this.repository.current(tx, viewer, message.stream_id);
    if (!state) throw new Error('read_state_missing');
    // A delayed device may submit an earlier visible message after the saved
    // high-water message was deleted. Retain the high-water mark, reveal no tombstone.
    return this.project(tx, viewer, message.stream_id, state.last_read_order);
  }

  // M10 must fence the account before calling this restartable, transaction-scoped port.
  // No offset: deleting each batch makes the next call naturally continue.
  purgeAccount(tx: Transaction, userId: string, limit: number): Promise<{ deleted: number; hasMore: boolean }> {
    if (!tx.writable) throw new Error('transaction_not_writable');
    identifier(userId);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new ApiError('INVALID_REQUEST', 400);
    return this.repository.purgeAccount(tx, userId, limit);
  }
}
