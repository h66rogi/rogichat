import { createHash } from 'node:crypto';
import { encodeDeletionIntent } from './deletion-ledger.js';
import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import type { DeletionReceipt } from './deletion-ledger.js';

/** Private account authority and bounded non-content dependency persistence. */
@Injectable()
export class AccountCleanupRepository {
  async authorize(tx: Transaction, receipt: DeletionReceipt) {
    const { intent } = receipt;
    if (intent.scope !== 'ACCOUNT' || !createHash('sha256').update(encodeDeletionIntent(intent)).digest().equals(Buffer.from(receipt.sha256, 'hex'))) throw new Error('account_cleanup_not_admitted');
    // Current projections, never an earlier RR snapshot. Checkpoint precedes account,
    // matching admission replay; all later domain/job locks follow the account.
    const [checkpoint] = await tx.rows<{ environment: string; scope: string; actor_user_id: string; target_id: string;
      room_id: string | null; requested_at: Date; ledger_sha256: Buffer; blocked_at: Date | null }>(
      'SELECT environment,scope,actor_user_id,target_id,room_id,requested_at,ledger_sha256,blocked_at FROM deletion_intents WHERE request_id=? FOR SHARE', [intent.requestId]);
    if (!checkpoint || checkpoint.environment !== intent.environment || checkpoint.scope !== 'ACCOUNT' ||
        checkpoint.actor_user_id !== intent.actorUserId || checkpoint.target_id !== intent.targetId || checkpoint.room_id !== null ||
        checkpoint.requested_at.toISOString() !== intent.requestedAt || checkpoint.ledger_sha256.toString('hex') !== receipt.sha256 || !checkpoint.blocked_at) {
      throw new Error('account_cleanup_not_admitted');
    }
    const [account] = await tx.rows<{ status: string }>('SELECT status FROM users WHERE id=? FOR UPDATE', [intent.targetId]);
    if (!account || !['DELETING', 'DELETED'].includes(account.status)) throw new Error('account_cleanup_not_blocked');
    const [obligation] = await tx.rows<{ request_id: string; requested_at: Date; blocked_at: Date | null; guard_coverage: number; state: string }>(
      'SELECT request_id,requested_at,blocked_at,guard_coverage,state FROM account_deletion_obligations WHERE user_id=? FOR SHARE', [intent.targetId]);
    if (!obligation || obligation.request_id !== intent.requestId || obligation.requested_at.toISOString() !== intent.requestedAt ||
        !obligation.blocked_at || !Number(obligation.guard_coverage) || !['BLOCKED', 'PURGING'].includes(obligation.state)) {
      throw new Error('account_cleanup_obligation_unavailable');
    }
  }

  async privateFields(tx: Transaction, userId: string) {
    let changed = (await tx.prisma.creator_accounts.deleteMany({ where: { user_id: userId } })).count;
    changed += (await tx.prisma.password_accounts.deleteMany({ where: { user_id: userId } })).count;
    changed += (await tx.prisma.users.updateMany({ where: { id: userId, reviewer_expires_at: { not: null } }, data: { reviewer_expires_at: null } })).count;
    changed += (await tx.prisma.platform_soop.updateMany({ where: { user_id: userId,
      OR: [{ profile_nickname: { not: null } }, { profile_image_url: { not: null } }] },
      data: { profile_nickname: null, profile_image_url: null } })).count;
    changed += (await tx.prisma.admin_capabilities.deleteMany({ where: { user_id: userId } })).count;
    changed += (await tx.prisma.melomingUserAlias.deleteMany({ where: { userId } })).count;
    // Keep the avatar FK until a separate durable media transfer proves detachment
    // safe. Empty nickname is internal scrubbed data, never a successful profile DTO.
    changed += (await tx.prisma.user_profiles.deleteMany({ where: { user_id: userId, avatar_asset_id: null } })).count;
    changed += (await tx.prisma.user_profiles.updateMany({ where: { user_id: userId, avatar_asset_id: { not: null }, OR: [
      { nickname: { not: '' } }, { birthday_month: { not: null } }, { birthday_day: { not: null } }, { birthday_visible_to_streamers: true },
    ] }, data: { nickname: '', birthday_month: null, birthday_day: null, birthday_visible_to_streamers: false, revision: { increment: 1n } } })).count;
    return changed;
  }

  /** Drain Meloming channel data introduced into Rogichat before account closure. */
  async channelContent(tx: Transaction, userId: string, limit: number) {
    const ownSongRequests = await tx.prisma.songAddRequest.findMany({ where: { requesterId: userId }, orderBy: { id: 'asc' }, take: limit, select: { id: true } });
    if (ownSongRequests.length) return (await tx.prisma.songAddRequest.deleteMany({ where: { requesterId: userId, id: { in: ownSongRequests.map(row => row.id) } } })).count;
    const processedSongRequests = await tx.prisma.songAddRequest.findMany({ where: { processedById: userId }, orderBy: { id: 'asc' }, take: limit, select: { id: true } });
    if (processedSongRequests.length) return (await tx.prisma.songAddRequest.updateMany({ where: { processedById: userId, id: { in: processedSongRequests.map(row => row.id) } }, data: { processedById: null } })).count;
    const likes = await tx.prisma.userSongLike.findMany({ where: { userId }, orderBy: { id: 'asc' }, take: limit, select: { id: true } });
    if (likes.length) return (await tx.prisma.userSongLike.deleteMany({ where: { userId, id: { in: likes.map(row => row.id) } } })).count;
    const authored = await tx.prisma.channelSchedule.findMany({ where: { authorUserId: userId }, orderBy: { id: 'asc' }, take: limit, select: { id: true } });
    if (authored.length) return (await tx.prisma.channelSchedule.deleteMany({ where: { authorUserId: userId, id: { in: authored.map(row => row.id) } } })).count;

    // This feature writes only to the primary room. Its owner-bound content is
    // removed when that owner closes the account; another user's room is safe.
    const binding = await tx.prisma.default_room_bindings.findUnique({ where: { key: 'primary' }, select: { room_id: true } });
    if (!binding) return 0;
    const room = await tx.prisma.rooms.findUnique({ where: { id: binding.room_id }, select: { owner: { select: { user_id: true } } } });
    if (room?.owner?.user_id !== userId) return 0;
    const channelId = binding.room_id;
    const songRequests = await tx.prisma.songAddRequest.findMany({ where: { channelId }, orderBy: { id: 'asc' }, take: limit, select: { id: true } });
    if (songRequests.length) return (await tx.prisma.songAddRequest.deleteMany({ where: { channelId, id: { in: songRequests.map(row => row.id) } } })).count;
    const songLikes = await tx.prisma.userSongLike.findMany({ where: { song: { channelId } }, orderBy: { id: 'asc' }, take: limit, select: { id: true } });
    if (songLikes.length) return (await tx.prisma.userSongLike.deleteMany({ where: { id: { in: songLikes.map(row => row.id) } } })).count;
    const songCategories = await tx.prisma.songCategory.findMany({ where: { song: { channelId } }, orderBy: { id: 'asc' }, take: limit, select: { id: true } });
    if (songCategories.length) return (await tx.prisma.songCategory.deleteMany({ where: { id: { in: songCategories.map(row => row.id) } } })).count;
    const songs = await tx.prisma.song.findMany({ where: { channelId }, orderBy: { id: 'asc' }, take: limit, select: { id: true } });
    if (songs.length) return (await tx.prisma.song.deleteMany({ where: { channelId, id: { in: songs.map(row => row.id) } } })).count;
    const artists = await tx.prisma.artist.findMany({ where: { channelId }, orderBy: { id: 'asc' }, take: limit, select: { id: true } });
    if (artists.length) return (await tx.prisma.artist.deleteMany({ where: { channelId, id: { in: artists.map(row => row.id) } } })).count;
    const categories = await tx.prisma.category.findMany({ where: { channelId }, orderBy: { id: 'asc' }, take: limit, select: { id: true } });
    if (categories.length) return (await tx.prisma.category.deleteMany({ where: { channelId, id: { in: categories.map(row => row.id) } } })).count;
    const items = await tx.prisma.channelWardrobeItem.findMany({ where: { channelId }, orderBy: { id: 'asc' }, take: limit, select: { id: true } });
    if (items.length) return (await tx.prisma.channelWardrobeItem.deleteMany({ where: { channelId, id: { in: items.map(row => row.id) } } })).count;
    const wardrobeCategories = await tx.prisma.channelWardrobeCategory.findMany({ where: { channelId }, orderBy: { id: 'asc' }, take: limit, select: { id: true } });
    if (wardrobeCategories.length) return (await tx.prisma.channelWardrobeCategory.deleteMany({ where: { channelId, id: { in: wardrobeCategories.map(row => row.id) } } })).count;
    const schedules = await tx.prisma.channelSchedule.findMany({ where: { channelId }, orderBy: { id: 'asc' }, take: limit, select: { id: true } });
    if (schedules.length) return (await tx.prisma.channelSchedule.deleteMany({ where: { channelId, id: { in: schedules.map(row => row.id) } } })).count;
    const recurring = await tx.prisma.channelRecurringSchedule.findMany({ where: { channelId }, orderBy: { id: 'asc' }, take: limit, select: { id: true } });
    if (recurring.length) return (await tx.prisma.channelRecurringSchedule.deleteMany({ where: { channelId, id: { in: recurring.map(row => row.id) } } })).count;
    const layouts = await tx.prisma.channelOverlayLayout.findMany({ where: { channelId }, orderBy: { id: 'asc' }, take: limit, select: { id: true } });
    if (layouts.length) return (await tx.prisma.channelOverlayLayout.deleteMany({ where: { channelId, id: { in: layouts.map(row => row.id) } } })).count;
    const profile = await tx.prisma.channelProfile.deleteMany({ where: { channelId } });
    if (profile.count) return profile.count;
    return 0;
  }

  async memberPage(tx: Transaction, userId: string, limit: number) {
    // Retained, fully drained UUID rows must not starve later rooms. This is one
    // account-scoped existence query, not a materialized scan of every room.
    const member = await tx.prisma.room_members.findFirst({ where: { user_id: userId, OR: [
      { status: { not: 'LEFT' } }, { active_period_id: { not: null } }, { reactions: { some: {} } },
      { grants: { some: {} } }, { periods: { some: {} } }, { delegations: { some: {} } },
    ] }, orderBy: { id: 'asc' }, select: { id: true, room_id: true } });
    if (!member) return null;
    await tx.rows('SELECT id FROM rooms WHERE id=? FOR UPDATE', [member.room_id]);
    // This room lock serializes cleanup with message projections. Commit the
    // cache scope change with each actual mutation, never with a drained retry.
    const changedPage = async (phase: 'membership' | 'reactions' | 'grants' | 'periods', changed: number) => {
      if (changed) await tx.prisma.rooms.update({ where: { id: member.room_id },
        data: { content_epoch: { increment: 1n } }, select: { id: true } });
      return { phase, changed };
    };
    const departed = await tx.prisma.room_members.updateMany({ where: { id: member.id, user_id: userId,
      OR: [{ status: { not: 'LEFT' } }, { active_period_id: { not: null } }] },
    data: { status: 'LEFT', active_period_id: null, acl_epoch: { increment: 1n } } });
    // Do not reassign rooms.owner_member_id or delete member/user UUID anchors.
    if (departed.count) return changedPage('membership', departed.count);
    const delegations = await tx.prisma.room_test_grants.findMany({ where: { member_id: member.id, room_id: member.room_id }, orderBy: { id: 'asc' }, take: limit, select: { id: true } });
    if (delegations.length) return changedPage('grants', (await tx.prisma.room_test_grants.deleteMany({ where: { id: { in: delegations.map(g => g.id) } } })).count);
    const reactions = await tx.prisma.message_reactions.findMany({ where: { member_id: member.id, room_id: member.room_id },
      orderBy: { id: 'asc' }, take: limit, select: { id: true } });
    if (reactions.length) return changedPage('reactions', (await tx.prisma.message_reactions.deleteMany({ where: {
      member_id: member.id, room_id: member.room_id, id: { in: reactions.map(row => row.id) },
    } })).count);
    const grants = await tx.prisma.stream_grants.findMany({ where: { member_id: member.id, room_id: member.room_id },
      orderBy: { id: 'asc' }, take: limit, select: { id: true } });
    if (grants.length) return changedPage('grants', (await tx.prisma.stream_grants.deleteMany({ where: {
      member_id: member.id, room_id: member.room_id, id: { in: grants.map(row => row.id) },
    } })).count);
    // ReadStateCore has already drained all account read states before this port.
    // Ended participation has no remaining FK consumer; remove its private history.
    const periods = await tx.prisma.membership_periods.findMany({ where: { member_id: member.id, room_id: member.room_id },
      orderBy: { id: 'asc' }, take: limit, select: { id: true } });
    if (periods.length) return changedPage('periods', (await tx.prisma.membership_periods.deleteMany({ where: {
      member_id: member.id, room_id: member.room_id, id: { in: periods.map(row => row.id) },
    } })).count);
    // A concurrent physical-content cleanup can remove our discovered work.
    return { phase: 'membership' as const, changed: 0 };
  }

  async profileChanges(tx: Transaction, userId: string, limit: number) {
    const page = await tx.prisma.profile_changes.findMany({ where: { user_id: userId }, orderBy: { id: 'asc' }, take: limit, select: { id: true } });
    if (!page.length) return 0;
    const ids = page.map(row => row.id);
    const jobs = await tx.prisma.jobs.findMany({ where: { purpose: 'REALTIME_HINT', room_id: null, resource_id: { in: ids } }, take: limit, orderBy: { id: 'asc' }, select: { id: true } });
    if (jobs.length) return (await tx.prisma.jobs.deleteMany({ where: { id: { in: jobs.map(row => row.id) }, purpose: 'REALTIME_HINT', room_id: null } })).count;
    return (await tx.prisma.profile_changes.deleteMany({ where: { id: { in: ids }, user_id: userId } })).count;
  }
  async mediaUsage(tx: Transaction, userId: string, limit: number) {
    const page = await tx.prisma.media_daily_usage.findMany({ where: { user_id: userId }, orderBy: { day: 'asc' }, take: limit, select: { day: true } });
    return page.length ? (await tx.prisma.media_daily_usage.deleteMany({ where: { user_id: userId, day: { in: page.map(row => row.day) } } })).count : 0;
  }
  async sessions(tx: Transaction, userId: string, limit: number) {
    const rows = await tx.prisma.auth_sessions.findMany({ where: { user_id: userId }, orderBy: { id: 'asc' }, take: limit, select: { id: true } });
    return rows.length ? (await tx.prisma.auth_sessions.deleteMany({ where: { user_id: userId, id: { in: rows.map(row => row.id) } } })).count : 0;
  }
}
