import { Inject, Injectable } from '@nestjs/common';
import { AccessService } from '../access/access.service.js';
import { MessagesCoreService } from '../messages/messages-core.service.js';
import { ReactionsRepository } from './reactions.repository.js';
import { randomUUID } from 'node:crypto';
import { reactionEmoji } from './dto/reaction.dto.js';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { ApiError } from '../../modules/auth/auth-primitives.js';
import { identifier } from '../../common/validation/identifier.js';
import { RoomStateService } from '../rooms/room-state.service.js';


@Injectable()
export class ReactionsCoreService {
  constructor(@Inject(ReactionsRepository) private readonly repository: ReactionsRepository, @Inject(AccessService) private readonly access: AccessService, @Inject(MessagesCoreService) private readonly messages: MessagesCoreService, @Inject(RoomStateService) private readonly roomState: RoomStateService) {}
  private async projection(tx: Transaction, roomId: string, messageId: string, memberId: string) {
    // Binary grouping is essential: the database's human-text collation may equate
    // distinct supplementary emoji or presentation/modifier sequences.
    const rows = await this.repository.counts(tx, roomId, messageId, await this.access.blockedActors(tx, roomId, memberId));
    const [mine] = await this.repository.mine(tx, roomId, messageId, memberId);
    return { counts: rows.map(row => ({ emoji: String(row.emoji), count: Number(row.total) })), mine: mine ? String(mine.emoji) : null };
  }

  // Caller requires the active session/account/SOOP in this same transaction.
  async readReactions(tx: Transaction, roomId: string, userId: string, messageId: string) {
    const viewer = await this.access.requireActiveMember(tx, identifier(roomId), userId);
    const message = await this.messages.load(tx, roomId, identifier(messageId));
    if (!message || !await this.messages.readable(tx, viewer, message)) throw new ApiError('NOT_FOUND', 404);
    return this.projection(tx, roomId, messageId, viewer.id);
  }

  async setReaction(tx: Transaction, roomId: string, userId: string, messageId: string, value: string | null) {
    const emoji = reactionEmoji(value);
    const [room] = await this.repository.lockRoom(tx, identifier(roomId));
    if (!room) throw new ApiError('NOT_FOUND', 404);
    const viewer = await this.access.requireActiveMember(tx, roomId, userId);
    const message = await this.messages.load(tx, roomId, identifier(messageId));
    if (!message || !await this.messages.readable(tx, viewer, message)) throw new ApiError('NOT_FOUND', 404);
    if (message.stream_kind === 'RESTRICTED' && (await this.access.actorBlocked(tx, roomId, viewer.id, message.sender_member_id, true) || await this.access.privateInteractionBlocked(tx, roomId, viewer.id, message.stream_id))) throw new ApiError('NOT_FOUND', 404);
    const [prior] = await this.repository.prior(tx, roomId, messageId, viewer.id);
    if ((prior ? String(prior.emoji) : null) === emoji) return this.projection(tx, roomId, messageId, viewer.id);
    if (emoji === null) await this.repository.remove(tx, roomId, messageId, viewer.id);
    else if (prior) await this.repository.replace(tx, emoji, prior.id, roomId, messageId, viewer.id);
    else await this.repository.insert(tx, randomUUID(), roomId, messageId, viewer.id, emoji);
    await this.repository.advanceVersion(tx, roomId, messageId);
    const order = await this.roomState.nextOrder(tx, roomId);
    await this.messages.recordEvent(tx, message, (BigInt(message.version) + 1n).toString(), order, 'MESSAGE_UPDATED');
    return this.projection(tx, roomId, messageId, viewer.id);
  }

}
