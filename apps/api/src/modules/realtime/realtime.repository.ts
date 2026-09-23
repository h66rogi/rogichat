import { delegatedMemberSql } from '../access/delegation-policy.js';
import { chatAccountSql, chatUser } from '../auth/chat-entitlement.js';
import { Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import type { JobLease } from '../../modules/jobs/jobs.policy.js';
export interface EventRef { roomId: string; eventId: string }
@Injectable()
export class RealtimeRepository {
  async validSessions(tx: Transaction, ids: string[], environmentAudience: string, refs?: EventRef[], profiles: string[] = []): Promise<Set<string>> {
    if (refs === undefined) {
      const rows = await tx.prisma.auth_sessions.findMany({ where: { id: { in: ids }, audience: environmentAudience, revoked_at: null, expires_at: { gt: await tx.now() }, user: { ...chatUser(await tx.now()) } }, select: { id: true } });
      return new Set(rows.map(row => row.id));
    }
    const messageAudience = refs?.length ? `EXISTS (
      SELECT 1 FROM room_members m JOIN rooms r ON r.id=m.room_id AND r.status='ACTIVE'
      JOIN membership_periods p ON p.room_id=m.room_id AND p.member_id=m.id AND p.id=m.active_period_id AND p.left_at IS NULL
      JOIN room_events e ON e.room_id=m.room_id
      JOIN messages msg ON msg.room_id=e.room_id AND msg.stream_id=e.stream_id AND msg.id=e.message_id
      JOIN message_streams stream ON stream.room_id=e.room_id AND stream.id=e.stream_id
      WHERE m.user_id=s.user_id AND m.status='ACTIVE' AND msg.created_order>=p.visible_from_order
      AND NOT EXISTS (SELECT 1 FROM actor_blocks b WHERE b.room_id=m.room_id AND ((b.blocker_actor_id=m.id AND b.target_actor_id=msg.sender_member_id) OR (b.target_actor_id=m.id AND b.blocker_actor_id=msg.sender_member_id)))
      AND (${refs.map(() => '(e.id=? AND e.room_id=?)').join(' OR ')})
      AND (stream.kind='ROOM_SHARED' OR ${delegatedMemberSql('m')} OR EXISTS (SELECT 1 FROM stream_grants g
        WHERE g.room_id=m.room_id AND g.stream_id=stream.id AND g.member_id=m.id AND g.can_read=1
        AND g.revoked_at IS NULL AND g.valid_from<=UTC_TIMESTAMP(3) AND (g.expires_at IS NULL OR g.expires_at>UTC_TIMESTAMP(3)))))` : '';
    const profileAudience = profiles.length ? `EXISTS (
      SELECT 1 FROM profile_changes pc JOIN users subject ON subject.id=pc.user_id AND subject.status='ACTIVE'
      LEFT JOIN platform_soop subject_platform ON subject_platform.user_id=subject.id
      JOIN room_members target ON target.user_id=subject.id AND target.status='ACTIVE'
      JOIN rooms r ON r.id=target.room_id AND r.status='ACTIVE'
      JOIN membership_periods tp ON tp.id=target.active_period_id AND tp.room_id=target.room_id AND tp.member_id=target.id AND tp.left_at IS NULL
      JOIN room_members viewer ON viewer.room_id=r.id AND viewer.user_id=s.user_id AND viewer.status='ACTIVE'
      JOIN membership_periods vp ON vp.id=viewer.active_period_id AND vp.room_id=viewer.room_id AND vp.member_id=viewer.id AND vp.left_at IS NULL
      WHERE ${chatAccountSql('subject', 'subject_platform')} AND NOT EXISTS (SELECT 1 FROM actor_blocks b WHERE b.room_id=r.id AND b.blocker_actor_id=viewer.id AND b.target_actor_id=target.id) AND pc.id IN (${profiles.map(() => '?').join(',')}) AND
      ((pc.public_changed=1 AND (r.mode='GROUP' OR target.role='STREAMER' OR ${delegatedMemberSql('target')} OR target.user_id=viewer.user_id OR viewer.role='STREAMER' OR ${delegatedMemberSql('viewer')}))
      OR (pc.streamer_changed=1 AND (viewer.role='STREAMER' OR ${delegatedMemberSql('viewer')}))))` : '';
    const predicates = [messageAudience, profileAudience].filter(Boolean);
    const audience = refs !== undefined ? ` AND (${predicates.join(' OR ') || '0'})` : '';

      const rows = await tx.rows<RowDataPacket>(`SELECT s.id FROM auth_sessions s JOIN users u ON u.id=s.user_id AND u.status='ACTIVE'
        LEFT JOIN platform_soop platform ON platform.user_id=u.id
        WHERE ${chatAccountSql('u', 'platform')} AND s.id IN (${ids.map(() => '?').join(',')}) AND s.audience=? AND s.revoked_at IS NULL AND s.expires_at>UTC_TIMESTAMP(3)${audience}`,
      [...ids, environmentAudience, ...(refs?.flatMap(ref => [ref.eventId, ref.roomId]) ?? []), ...profiles]);
      return new Set(rows.map(row => String(row.id)));
  }
  async existing(tx: Transaction, leases: JobLease[]) {
    const messages = leases.filter(lease => lease.roomId && lease.resourceId);
    const changes = leases.filter(lease => !lease.roomId && lease.resourceId);
    const events = messages.length ? await tx.prisma.room_events.findMany({ where: { OR: messages.map(lease => ({ id: lease.resourceId!, room_id: lease.roomId! })) }, select: { id: true, room_id: true } }) : [];
    const profile = changes.length ? await tx.prisma.profile_changes.findMany({ where: { id: { in: changes.map(lease => lease.resourceId!) } }, select: { id: true } }) : [];
    return { events: new Set(events.map(row => `${row.room_id}:${row.id}`)), profiles: new Set(profile.map(row => row.id)) };
  }

}
