import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { Transaction } from '../../infrastructure/database/transactions.js';

type NativeSelection = { id: true, channel: true, browser_digest: true, verifier: true, intent: true,
  terms_version: true, audience: true, user_id: true, session_id: true, status: true, expires_at: true,
  client_id: true, app_challenge: true, return_state: true, launch_expires: true,
  launch_payload: true, launched_at: true, completion_digest: true, completion_expires: true,
  identity_payload: true, bound_generation: true };
export type NativeTransaction = Prisma.login_transactionsGetPayload<{ select: NativeSelection }>;
type LockedTransaction = Omit<NativeTransaction, 'bound_generation'> & { bound_generation: string | null };
const lockedColumns = 'id,channel,browser_digest,verifier,intent,terms_version,audience,user_id,session_id,status,expires_at,client_id,app_challenge,return_state,launch_expires,launch_payload,launched_at,completion_digest,completion_expires,identity_payload,bound_generation';

@Injectable()
export class NativeAuthRepository {
  async channel(tx: Transaction, state: Buffer, audience: string) {
    return (await tx.prisma.login_transactions.findFirst({ where: { state_digest: new Uint8Array(state), audience }, select: { channel: true } }))?.channel;
  }
  async lock(tx: Transaction, key: { id: string } | { state: Buffer } | { launch: Buffer }, audience: string): Promise<NativeTransaction | null> {
    // Stage consumption requires a current row lock. Read its projection with
    // that lock: a separate RR consistent read here would establish a snapshot
    // before a concurrent first-login account exists, hiding its profile later.
    // Identifiers are fixed; all values are bound and mutations use Prisma.
    const rows = 'id' in key
      ? await tx.rows<LockedTransaction>(`SELECT ${lockedColumns} FROM login_transactions WHERE id=? AND audience=? AND channel=? FOR UPDATE`, [key.id, audience, 'NATIVE'])
      : 'state' in key
        ? await tx.rows<LockedTransaction>(`SELECT ${lockedColumns} FROM login_transactions WHERE state_digest=? AND audience=? AND channel=? FOR UPDATE`, [key.state, audience, 'NATIVE'])
        : await tx.rows<LockedTransaction>(`SELECT ${lockedColumns} FROM login_transactions WHERE launch_digest=? AND audience=? AND channel=? FOR UPDATE`, [key.launch, audience, 'NATIVE']);
    const row = rows[0];
    return row ? { ...row, bound_generation: row.bound_generation === null ? null : BigInt(row.bound_generation) } : null;
  }
  async create(tx: Transaction, data: Prisma.login_transactionsCreateInput): Promise<void> {
    await tx.prisma.login_transactions.create({ data, select: { id: true } });
  }
  async update(tx: Transaction, id: string, data: Prisma.login_transactionsUpdateInput): Promise<void> {
    await tx.prisma.login_transactions.update({ where: { id }, data, select: { id: true } });
  }
  async fail(tx: Transaction, id: string): Promise<void> {
    await tx.prisma.login_transactions.updateMany({ where: { id, channel: 'NATIVE', status: { in: ['PENDING', 'PROCESSING'] } },
      data: { status: 'FAILED', verifier: Buffer.alloc(0), launch_payload: null, identity_payload: null, completion_digest: null } });
  }
}
