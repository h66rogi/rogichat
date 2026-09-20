import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';

export interface LoginRow {
  id: string; browser_digest: Buffer; verifier: Buffer; intent: string; terms_version: string | null; user_id: string | null; session_id: string | null;
}

@Injectable()
export class LoginRepository {
  async recentSession(tx: Transaction, sessionId: string): Promise<boolean> {
    return await tx.prisma.auth_sessions.count({ where: { id: sessionId, created_at: { gt: new Date((await tx.now()).getTime() - 900000) } } }) > 0;
  }
  async insert(tx: Transaction, input: { id: string; stateDigest: Buffer; browserDigest: Buffer; verifier: Buffer; intent: string; audience: string; userId: string | undefined; sessionId: string | undefined }): Promise<void> {
    await tx.prisma.login_transactions.create({ data: { id: input.id, state_digest: new Uint8Array(input.stateDigest), browser_digest: new Uint8Array(input.browserDigest), verifier: new Uint8Array(input.verifier), intent: input.intent, terms_version: input.intent === 'login' ? '2026-09-20' : null, audience: input.audience, user_id: input.userId ?? null, session_id: input.sessionId ?? null, expires_at: new Date((await tx.now()).getTime() + 600000) }, select: { id: true } });
  }
  async pending(tx: Transaction, stateDigest: Buffer, audience: string): Promise<LoginRow | undefined> {
    const [row] = await tx.rows<LoginRow>('SELECT id,browser_digest,verifier,intent,terms_version,user_id,session_id FROM login_transactions WHERE state_digest=? AND audience=? AND status=? AND channel=? AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE', [stateDigest, audience, 'PENDING', 'WEB']);
    return row;
  }
  async processing(tx: Transaction, id: string): Promise<boolean> {
    return (await tx.rows('SELECT id FROM login_transactions WHERE id=? AND status=? AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE', [id, 'PROCESSING'])).length > 0;
  }
  async claim(tx: Transaction, id: string): Promise<void> {
    await tx.prisma.login_transactions.updateMany({ where: { id }, data: { status: 'PROCESSING' } });
  }
  async terms(tx: Transaction, userId: string, version: string): Promise<void> {
    await tx.prisma.users.updateMany({ where: { id: userId }, data: { terms_version: version } });
  }
  async revokeSession(tx: Transaction, id: string): Promise<void> {
    await tx.prisma.auth_sessions.updateMany({ where: { id }, data: { revoked_at: await tx.now() } });
  }
  async finish(tx: Transaction, id: string, status: 'SUCCEEDED' | 'FAILED'): Promise<void> {
    await tx.prisma.login_transactions.updateMany({ where: { id }, data: { status, verifier: Buffer.alloc(0) } });
  }
  async fail(tx: Transaction, id: string): Promise<void> {
    await tx.prisma.login_transactions.updateMany({ where: { id, status: { in: ['PENDING', 'PROCESSING'] } }, data: { status: 'FAILED', verifier: Buffer.alloc(0) } });
  }

}
