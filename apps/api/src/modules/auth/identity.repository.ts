import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import type { SoopProfile } from './soop-profile.contract.js';

@Injectable()
export class IdentityRepository {
  async initializeProfile(tx: Transaction, userId: string, profile: SoopProfile) {
    await tx.rows('SELECT user_id FROM user_profiles WHERE user_id=? FOR UPDATE', [userId]);
    const current = await tx.prisma.user_profiles.findUnique({ where: { user_id: userId }, select: {
      nickname: true, revision: true, avatar_asset_id: true, provider_profile_initialized: true, nickname_customized: true, avatar_customized: true,
    } });
    if (!current) return;
    // Initial metadata only: future OAuth exchanges never silently synchronize
    // an already initialized profile or resurrect a cleared provider avatar.
    if (current.provider_profile_initialized) return;
    const legacy = !current.provider_profile_initialized && current.revision > 1n;
    const nameChanged = !current.nickname_customized && !legacy && current.nickname === '새 사용자' && profile.nickname !== null;
    await tx.prisma.platform_soop.updateMany({ where: { user_id: userId, status: 'VERIFIED' },
      data: { profile_nickname: profile.nickname, profile_image_url: profile.imageUrl } });
    // Legacy revision>1 may already represent a user edit, including selecting
    // the same placeholder or deliberately clearing an avatar. Never overwrite.
    const avatarChanged = !legacy && !current.avatar_customized && current.avatar_asset_id === null && profile.imageUrl !== null;
    const publicChanged = nameChanged || avatarChanged;
    await tx.prisma.user_profiles.updateMany({ where: { user_id: userId }, data: {
      provider_profile_initialized: true,
      ...(legacy ? { nickname_customized: true, avatar_customized: true } : {}),
      ...(nameChanged ? { nickname: profile.nickname! } : {}),
      ...(publicChanged ? { revision: { increment: 1n } } : {}),
    } });
    if (publicChanged) {
      const id = randomUUID();
      await tx.prisma.profile_changes.create({ data: { id, user_id: userId, public_changed: true, streamer_changed: false }, select: { id: true } });
      return id;
    }
    return undefined;
  }
  async findSubject(tx: Transaction, subject: Buffer) {
    const [row] = await tx.rows<RowDataPacket>('SELECT user_id,status FROM platform_soop WHERE provider_subject=? FOR UPDATE', [subject]);
    return row;
  }
  async account(tx: Transaction, userId: string) {
    const [row] = await tx.rows<RowDataPacket>('SELECT status FROM users WHERE id=? FOR UPDATE', [userId]);
    return row;
  }
  async reverify(tx: Transaction, userId: string) {
    const result = await tx.prisma.platform_soop.updateMany({ where: { user_id: userId, status: 'REVOKED' }, data: { status: 'VERIFIED', verified_at: await tx.now() } });
    if (result.count) await tx.prisma.users.updateMany({ where: { id: userId }, data: { membership_generation: { increment: 1n } } });
  }
  async linked(tx: Transaction, userId: string): Promise<boolean> {
    return (await tx.rows('SELECT id FROM platform_soop WHERE user_id=? FOR UPDATE', [userId])).length > 0;
  }
  async registerAccount(tx: Transaction): Promise<string> {
    const id = randomUUID();
    await tx.prisma.users.create({ data: { id, profile: { create: { nickname: '새 사용자' } } }, select: { id: true } });
    return id;
  }
  async link(tx: Transaction, userId: string, subject: Buffer): Promise<void> {
    await tx.prisma.platform_soop.create({ data: { id: randomUUID(), user_id: userId, provider_subject: new Uint8Array(subject), verified_at: await tx.now() }, select: { id: true } });
    await tx.prisma.users.updateMany({ where: { id: userId }, data: { membership_generation: { increment: 1n } } });
  }

}
