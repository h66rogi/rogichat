import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import type { ActiveMember } from '../access/access.types.js';
import type { MessageReadModel } from './message-projection.js';
import { MessageEligibilityRepository } from './message-eligibility.repository.js';

export type MessageEligibility = Pick<MessageReadModel, 'counterpart' | 'allowedActions'>;
export const noMessageActions = (): MessageEligibility => ({ counterpart: null, allowedActions: { reply: false, publish: false, delete: false } });
const actorUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

@Injectable()
export class MessageEligibilityService {
  constructor(@Inject(MessageEligibilityRepository) private readonly repository: MessageEligibilityRepository) {}

  // IDs must already be authorized LIVE messages. Hints never authorize a mutation
  // or broaden read access. Batch once per page, excluding tombstones/lookahead.
  async project(tx: Transaction, viewer: ActiveMember, ids: string[], now?: Date): Promise<Map<string, MessageEligibility>> {
    const result = new Map(ids.map(id => [id, noMessageActions()]));
    if (!ids.length) return result;
    const blocks = await this.repository.blocks(tx, viewer.room_id, viewer.id);
    const blocked = new Set(blocks.map(row => row.blocker_actor_id === viewer.id ? row.target_actor_id : row.blocker_actor_id));
    const messages = await this.repository.messages(tx, viewer.room_id, ids);
    const targetIds = new Set<string>();
    for (const message of messages) {
      if (message.deletion_root_id) continue;
      if (message.stream.kind === 'ROOM_SHARED') targetIds.add(message.sender_member_id);
      else if (message.stream.pair) {
        targetIds.add(message.stream.pair.left_member_id); targetIds.add(message.stream.pair.right_member_id);
      }
    }
    targetIds.delete(viewer.id);
    const members = await this.repository.members(tx, viewer.room_id, [viewer.id, ...targetIds]);
    const current = members.find(member => member.id === viewer.id && member.user_id === viewer.user_id &&
      member.active_period_id === viewer.active_period_id && member.active_period?.member_id === viewer.id &&
      String(member.active_period.visible_from_order) === viewer.visible_from_order);
    const pairs = current ? await this.repository.pairs(tx, viewer.room_id, viewer.id, [...targetIds]) : [];
    const grants = pairs.length ? await this.repository.grants(tx, viewer.room_id, pairs.map(pair => pair.stream_id), [viewer.id, ...targetIds], now) : [];
    const eligibleTarget = (targetId: string, requiredStream?: string): boolean => {
      if (blocked.has(targetId) || !current || targetId === viewer.id || !actorUuid.test(targetId)) return false;
      const target = members.find(member => member.id === targetId && member.active_period_id && member.active_period?.member_id === targetId);
      if (!target) return false;
      if (current.room.mode === 'FAN' && !((current.role === 'FAN' && target.role === 'STREAMER') ||
        (current.role === 'STREAMER' && target.role === 'FAN'))) return false;
      const pair = pairs.find(pair => (pair.left_member_id === viewer.id && pair.right_member_id === targetId) ||
        (pair.right_member_id === viewer.id && pair.left_member_id === targetId));
      // A shared-author reply may create a new private pair. An existing pair's
      // revoked grants are never repaired, even after membership rejoin.
      if (!pair) return requiredStream === undefined;
      if (requiredStream !== undefined && pair.stream_id !== requiredStream) return false;
      const ownGrant = grants.find(grant => grant.stream_id === pair.stream_id && grant.member_id === viewer.id);
      const peerGrant = grants.find(grant => grant.stream_id === pair.stream_id && grant.member_id === targetId);
      return ownGrant?.can_read === true && ownGrant.can_send === true && peerGrant?.can_read === true;
    };
    for (const message of messages) {
      const hints = noMessageActions();
      // Publication sender is the publisher; content_owner is deliberately unused.
      hints.allowedActions.delete = message.sender.user_id === viewer.user_id;
      hints.allowedActions.publish = Boolean(current && current.role === 'STREAMER' && current.room.owner_member_id === viewer.id &&
        message.stream.kind === 'RESTRICTED' && !message.deletion_root_id &&
        (message.content_kind === 'PHOTO' || (message.content_kind === 'TEXT' && message.text_content !== null)));
      if (!message.deletion_root_id && message.stream.room_id === viewer.room_id) {
        if (message.stream.kind === 'ROOM_SHARED') hints.allowedActions.reply = eligibleTarget(message.sender_member_id);
        else {
          const pair = message.stream.pair;
          if (pair && pair.room_id === viewer.room_id && pair.stream_id === message.stream.id &&
            [pair.left_member_id, pair.right_member_id].includes(message.sender_member_id)) {
            const opposite = pair.left_member_id === viewer.id ? pair.right_member_id : pair.right_member_id === viewer.id ? pair.left_member_id : null;
            if (opposite && eligibleTarget(opposite, message.stream.id)) {
              hints.counterpart = { actorId: opposite }; hints.allowedActions.reply = true;
            }
          }
        }
      }
      result.set(message.id, hints);
    }
    return result;
  }
}
