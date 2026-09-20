import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import type { LedgerEnvironment } from './deletion-ledger.js';
import { isDurablePurge, purgeDedupe } from '../jobs/jobs.policy.js';

@Injectable()
export class PurgeWorkerRepository {
  async discover(tx: Transaction, sourceId: string, environment: LedgerEnvironment) {
    await tx.prisma.deletion_purge_discovery.createMany({ data: [{ source_id: sourceId, environment }], skipDuplicates: true });
    await tx.rows('SELECT source_id FROM deletion_purge_discovery WHERE source_id=? AND environment=? FOR UPDATE', [sourceId, environment]);
    const now = await tx.now();
    const source = await tx.prisma.deletion_purge_discovery.findUniqueOrThrow({ where: { source_id_environment: { source_id: sourceId, environment } }, select: { cursor: true, next_scan_at: true } });
    if (source.next_scan_at > now) return [];
    const page = await tx.prisma.deletion_intents.findMany({ where: { environment, scope: { in: ['MESSAGE', 'ACCOUNT'] },
      ...(source.cursor ? { request_id: { gt: source.cursor } } : {}) }, orderBy: { request_id: 'asc' }, take: 20, select: { request_id: true } });
    await tx.prisma.deletion_purge_discovery.update({ where: { source_id_environment: { source_id: sourceId, environment } }, data: {
      cursor: page.length === 20 ? page.at(-1)!.request_id : null,
      next_scan_at: new Date(now.getTime() + (page.length === 20 ? 5000 : 60000)),
    }, select: { source_id: true } });
    return page.map(row => row.request_id);
  }
  async intent(tx: Transaction, requestId: string, environment: LedgerEnvironment) {
    await tx.rows('SELECT request_id FROM deletion_intents WHERE request_id=? FOR UPDATE', [requestId]);
    const intent = await tx.prisma.deletion_intents.findUnique({ where: { request_id: requestId }, select: { request_id: true, environment: true, scope: true, room_id: true } });
    if (!intent || intent.environment !== environment || !['MESSAGE', 'ACCOUNT'].includes(intent.scope)) return null;
    if (intent.scope === 'ACCOUNT' && intent.room_id !== null) return null;
    if (intent.scope === 'MESSAGE' && (!intent.room_id || !(await tx.rows('SELECT id FROM rooms WHERE id=? FOR SHARE', [intent.room_id])).length)) return null;
    return intent;
  }
  async recover(tx: Transaction, requestId: string, roomId: string | null) {
    // Only canonical, exact-resource jobs owned by this deletion runtime. No
    // terminal unrelated job is resurrected, and active leases are never stolen.
    const digest = purgeDedupe(requestId);
    const [locked] = await tx.rows<{ id: string }>('SELECT id FROM jobs WHERE purpose="PURGE" AND dedupe_key=? FOR UPDATE', [digest]);
    if (!locked) return;
    const now = await tx.now();
    const row = await tx.prisma.jobs.findUniqueOrThrow({ where: { id: locked.id }, select: {
      purpose: true, resource_id: true, dedupe_key: true, room_id: true, state: true, available_at: true, last_error_code: true,
    } });
    if (!isDurablePurge(row) || row.resource_id !== requestId || row.room_id !== roomId) throw new Error('purge_job_conflict');
    if (row.state !== 'FAILED' || row.available_at.getTime() + 300000 > now.getTime() ||
        !['ATTEMPTS_EXHAUSTED', 'TEMPORARY_UNAVAILABLE', 'DEPENDENCY_TIMEOUT', 'RATE_LIMITED', 'SOURCE_UNAVAILABLE', 'LEASE_EXPIRED'].includes(row.last_error_code ?? '')) return;
    await tx.prisma.jobs.updateMany({ where: { id: locked.id, state: 'FAILED' }, data: {
      state: 'PENDING', available_at: new Date(now.getTime() + 5000), generation: { increment: 1n },
      lease_owner: null, lease_token: null, lease_until: null,
      // Keep attempts and the recorded error: recovery is not a new clean job.
    } });
  }
}
