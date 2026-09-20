import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../../infrastructure/database/transactions.js';
import type { AppleRestoreInput } from './apple-restore.js';

/** Internal operator composition only. Caller holds the global restore fence. */
@Injectable()
export class AppleRestoreRepository {
  async page(tx: Transaction, input: AppleRestoreInput) {
    const now = await tx.now();
    // Current bounded row locks, not an inherited RR snapshot or caller SQL/table.
    const suffix = input.afterId ? ' AND id>?' : '';
    const values = input.afterId ? [input.afterId, input.limit] : [input.limit];
    let rows: { id: string }[];
    let pendingRevocations = 0;
    if (input.phase === 'identities') {
      rows = await tx.rows<{ id: string }>(`SELECT id FROM auth_identities WHERE provider='apple'${suffix} ORDER BY id LIMIT ? FOR UPDATE`, values);
      await tx.prisma.auth_identities.updateMany({ where: { id: { in: rows.map(row => row.id) }, provider: 'apple', OR: [{ status: { not: 'REVOKED' } }, { revoked_at: null }] }, data: { status: 'REVOKED', revoked_at: now } });
    } else if (input.phase === 'transactions') {
      rows = await tx.rows<{ id: string }>(`SELECT id FROM apple_auth_transactions WHERE 1=1${suffix} ORDER BY id LIMIT ? FOR UPDATE`, values);
      const ids = rows.map(row => row.id);
      await tx.prisma.apple_auth_transactions.updateMany({ where: { id: { in: ids }, status: { in: ['PENDING', 'PROCESSING'] } }, data: { status: 'FAILED' } });
      await tx.prisma.apple_auth_transactions.updateMany({ where: { id: { in: ids } }, data: { proof: null, completion_digest: null } });
    } else {
      const credentials = await tx.rows<{ id: string; status: string; token: Buffer | null }>(`SELECT id,status,token FROM apple_provider_credentials WHERE 1=1${suffix} ORDER BY id LIMIT ? FOR UPDATE`, values);
      rows = credentials;
      for (const row of credentials) {
        // No decrypt, delete or provider request. Unknown issuance remains an
        // obligation; an encrypted token remains usable only by the revoke worker.
        const status = row.token ? 'REVOKE_PENDING' : row.status === 'REVOKED' ? 'REVOKED' : 'EXCHANGE_UNKNOWN';
        await tx.prisma.apple_provider_credentials.update({ where: { id: row.id }, data: { status, lease_token: null, available_at: now }, select: { id: true } });
        if (status !== 'REVOKED') pendingRevocations++;
      }
    }
    return { phase: input.phase, lastId: rows.at(-1)?.id ?? input.afterId, hasMore: rows.length === input.limit, processed: rows.length, pendingRevocations };
  }
  async readiness(tx: Transaction) {
    const identities = await tx.rows("SELECT id FROM auth_identities WHERE provider='apple' AND (status<>'REVOKED' OR revoked_at IS NULL) ORDER BY id LIMIT 1 FOR UPDATE");
    const transactions = await tx.rows("SELECT id FROM apple_auth_transactions WHERE status IN ('PENDING','PROCESSING') OR proof IS NOT NULL OR completion_digest IS NOT NULL ORDER BY id LIMIT 1 FOR UPDATE");
    const credentials = await tx.rows("SELECT id FROM apple_provider_credentials WHERE status NOT IN ('REVOKED','REVOKE_PENDING','REVOKING','EXCHANGE_UNKNOWN') OR (status<>'REVOKING' AND lease_token IS NOT NULL) OR (status IN ('REVOKED','EXCHANGE_UNKNOWN') AND token IS NOT NULL) ORDER BY id LIMIT 1 FOR UPDATE");
    const upstream = await tx.rows("SELECT id FROM apple_provider_credentials WHERE status<>'REVOKED' OR token IS NOT NULL ORDER BY id LIMIT 1 FOR UPDATE");
    return { quarantined: identities.length === 0 && transactions.length === 0 && credentials.length === 0,
      identitiesPending: identities.length > 0, transactionsPending: transactions.length > 0, credentialsPending: credentials.length > 0,
      upstreamRevocationPending: upstream.length > 0 };
  }
}
