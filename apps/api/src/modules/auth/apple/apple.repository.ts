import { ApiError } from '../auth-primitives.js';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { Transaction } from '../../../infrastructure/database/transactions.js';
import { APPLE_ISSUER } from './apple-provider.js';

type AppleRow = Prisma.apple_auth_transactionsGetPayload<Record<string, never>>;
type LockedRow = Omit<AppleRow, 'bound_generation'> & { bound_generation: string | null };
const columns = 'id,audience,client_id,intent,state_digest,nonce,code_challenge,return_state,user_id,session_id,bound_generation,terms_version,status,created_at,expires_at,code_digest,completion_digest,completion_expires,proof';
export type AppleTransaction = AppleRow;
export interface AppleIdentity { id: string; user_id: string; status: string; verified_at: Date | null; revoked_at: Date | null }

@Injectable()
export class AppleRepository {
  create(tx: Transaction, data: Prisma.apple_auth_transactionsCreateInput) {
    return tx.prisma.apple_auth_transactions.create({ data, select: { id: true } });
  }
  async lock(tx: Transaction, audience: string, key: { id: string } | { state: Buffer }): Promise<AppleTransaction | null> {
    const [row] = 'id' in key
      ? await tx.rows<LockedRow>(`SELECT ${columns} FROM apple_auth_transactions WHERE id=? AND audience=? FOR UPDATE`, [key.id, audience])
      : await tx.rows<LockedRow>(`SELECT ${columns} FROM apple_auth_transactions WHERE state_digest=? AND audience=? FOR UPDATE`, [key.state, audience]);
    return row ? { ...row, bound_generation: row.bound_generation === null ? null : BigInt(row.bound_generation) } : null;
  }
  update(tx: Transaction, id: string, data: Prisma.apple_auth_transactionsUpdateInput) {
    return tx.prisma.apple_auth_transactions.update({ where: { id }, data, select: { id: true } });
  }
  async session(tx: Transaction, id: string, audience: string, client: string) {
    const [row] = await tx.rows<{ user_id: string; membership_generation: string; created_at: Date; terms_version: string | null }>(
      'SELECT s.user_id,u.membership_generation,s.created_at,u.terms_version FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.audience=? AND s.transport=? AND s.client_id <=> ? AND s.revoked_at IS NULL AND s.expires_at>UTC_TIMESTAMP(3) AND u.status=? FOR UPDATE',
      [id, audience, client === 'web' ? 'WEB' : 'NATIVE', client === 'web' ? null : client, 'ACTIVE']);
    return row;
  }
  async event(tx: Transaction, scope: string, subject: string) {
    // Create the subject fence before acquiring the identity/account locks, even
    // when no identity exists yet. Notification and admission use the same order.
    await tx.prisma.apple_identity_events.createMany({ data: [{ scope, subject: Buffer.from(subject), revoked_at: new Date(0) }], skipDuplicates: true });
    const [row] = await tx.rows<{ revoked_at: Date }>('SELECT revoked_at FROM apple_identity_events WHERE scope=? AND subject=? FOR UPDATE', [scope, Buffer.from(subject)]);
    if (!row) throw new Error('apple_event_fence_unavailable');
    return row.revoked_at;
  }
  async identity(tx: Transaction, scope: string, subject: string): Promise<AppleIdentity | undefined> {
    const [row] = await tx.rows<AppleIdentity>('SELECT id,user_id,status,verified_at,revoked_at FROM auth_identities WHERE provider=? AND issuer=? AND scope=? AND subject=? FOR UPDATE', ['apple', Buffer.from(APPLE_ISSUER), scope, Buffer.from(subject)]);
    return row;
  }
  async account(tx: Transaction, id: string) {
    const [row] = await tx.rows<{ status: string }>('SELECT status FROM users WHERE id=? FOR UPDATE', [id]); return row;
  }
  async register(tx: Transaction) {
    const id = randomUUID();
    await tx.prisma.users.create({ data: { id, terms_version: '2026-09-20', profile: { create: { nickname: '새 사용자' } } }, select: { id: true } }); return id;
  }
  async connect(tx: Transaction, existing: AppleIdentity | undefined, userId: string, scope: string, subject: string, issuedAt: Date) {
    if (!existing && await tx.prisma.auth_identities.count({ where: { user_id: userId, provider: 'apple' } }) >= 7) throw new ApiError('APPLE_LINK_CONFLICT', 409);
    const id = existing?.id ?? randomUUID();
    if (existing) await tx.prisma.auth_identities.update({ where: { id }, data: { status: 'VERIFIED', verified_at: issuedAt, revoked_at: null }, select: { id: true } });
    else await tx.prisma.auth_identities.create({ data: { id, user_id: userId, provider: 'apple', issuer: Buffer.from(APPLE_ISSUER), scope, subject: Buffer.from(subject), verified_at: issuedAt }, select: { id: true } });
    if (!existing || existing.status !== 'VERIFIED') await tx.prisma.users.update({ where: { id: userId }, data: { membership_generation: { increment: 1n } }, select: { id: true } });
    return id;
  }
  async prepareCredential(tx: Transaction, transactionId: string, audience: string, expires: Date, userId: string | null) {
    await tx.prisma.apple_provider_credentials.create({ data: { id: transactionId, transaction_id: transactionId, audience,
      user_id: userId, status: 'EXCHANGE_PENDING', expires_at: expires }, select: { id: true } });
  }
  async saveCredential(tx: Transaction, input: { id: string; transactionId: string; audience: string; token: Uint8Array<ArrayBuffer>; expires: Date }) {
    await tx.prisma.apple_provider_credentials.update({ where: { transaction_id: input.transactionId }, data: { token: input.token, status: 'PENDING' }, select: { id: true } });
  }
  async activateCredential(tx: Transaction, transactionId: string, identityId: string, userId: string) {
    const result = await tx.prisma.apple_provider_credentials.updateMany({ where: { transaction_id: transactionId, status: 'PENDING' }, data: { status: 'ACTIVE', identity_id: identityId, user_id: userId } });
    if (result.count !== 1) throw new Error('apple_credential_not_pending');
  }
  async noToken(tx: Transaction, id: string) {
    await tx.prisma.apple_provider_credentials.updateMany({ where: { transaction_id: id, status: 'EXCHANGE_PENDING', token: null }, data: { status: 'REVOKED' } });
  }
  async fail(tx: Transaction, id: string) {
    await tx.prisma.apple_auth_transactions.updateMany({ where: { id, status: { in: ['PENDING', 'PROCESSING'] } }, data: { status: 'FAILED', proof: null, completion_digest: null } });
    await tx.prisma.apple_provider_credentials.updateMany({ where: { transaction_id: id, status: 'EXCHANGE_PENDING' }, data: { status: 'EXCHANGE_UNKNOWN' } });
    await tx.prisma.apple_provider_credentials.updateMany({ where: { transaction_id: id, status: 'PENDING' }, data: { status: 'REVOKE_PENDING' } });
  }
}
