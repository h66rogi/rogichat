import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2';
import type { Transaction } from '../../infrastructure/database/transactions.js';

@Injectable()
export class IdentityRepository {
  async findSubject(tx: Transaction, subject: Buffer) {
    const [row] = await tx.rows<RowDataPacket>('SELECT user_id,status FROM platform_soop WHERE provider_subject=? FOR UPDATE', [subject]);
    return row;
  }
  async account(tx: Transaction, userId: string) {
    const [row] = await tx.rows<RowDataPacket>('SELECT status FROM users WHERE id=? FOR UPDATE', [userId]);
    return row;
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
