import { affected } from '../../infrastructure/database/transactions.js';
import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import type { JobPurpose } from './jobs.policy.js';
interface JobRow {
  id: string; purpose: JobPurpose; room_id: string | null; resource_id: string | null;
  generation: string; attempts: number; max_attempts: number;
}

const fence = 'id=? AND purpose=? AND generation=? AND lease_owner=? AND lease_token=? AND state="RUNNING" AND lease_until>UTC_TIMESTAMP(3)';
@Injectable()
export class JobsRepository {
  async insert(tx: Transaction, dedupe: boolean, values: unknown[]) {
    const [id, purpose, roomId, resourceId, maxAttempts, digest, delayMicroseconds] = values;
    const data = { id: String(id), purpose: purpose as JobPurpose, room_id: roomId === null ? null : String(roomId), resource_id: resourceId === null ? null : String(resourceId), max_attempts: Number(maxAttempts), dedupe_key: digest === null ? null : new Uint8Array(digest as Uint8Array), available_at: new Date((await tx.now()).getTime() + Number(delayMicroseconds) / 1000) };
    if (dedupe) return affected(tx.prisma.jobs.createMany({ data: [data], skipDuplicates: true }));
    await tx.prisma.jobs.create({ data, select: { id: true } });
    return { affectedRows: 1 };
  }
  dedupe(tx: Transaction, values: unknown[]) { return tx.rows<JobRow>('SELECT id,room_id,resource_id FROM jobs WHERE purpose=? AND dedupe_key=? FOR UPDATE', values); }
  complete(tx: Transaction, values: unknown[]) { return tx.execute(`UPDATE jobs SET state="COMPLETED",lease_owner=NULL,lease_token=NULL,lease_until=NULL,last_error_code=NULL WHERE ${fence}`, values); }
  claim(tx: Transaction, purposes: readonly JobPurpose[], limit: number) { return tx.rows<JobRow>(`SELECT id,purpose,room_id,resource_id,generation,attempts,max_attempts FROM jobs
        WHERE purpose IN (${purposes.map(() => '?').join(',')}) AND
          ((state="PENDING" AND available_at<=UTC_TIMESTAMP(3)) OR (state="RUNNING" AND lease_until<=UTC_TIMESTAMP(3)))
        ORDER BY CASE WHEN purpose="PURGE" THEN 0 ELSE 1 END,available_at,id LIMIT ? FOR UPDATE SKIP LOCKED`, [...purposes, limit]); }
  exhaust(tx: Transaction, values: unknown[]) {
    return affected(tx.prisma.jobs.updateMany({ where: { id: String(values[1]) }, data: { state: 'FAILED', generation: BigInt(String(values[0])), lease_owner: null, lease_token: null, lease_until: null, last_error_code: 'ATTEMPTS_EXHAUSTED' } }));
  }
  async lease(tx: Transaction, values: unknown[]) {
    return affected(tx.prisma.jobs.updateMany({ where: { id: String(values[4]) }, data: { state: 'RUNNING', generation: BigInt(String(values[0])), lease_owner: String(values[1]), lease_token: String(values[2]), lease_until: new Date((await tx.now()).getTime() + Number(values[3]) / 1000), attempts: { increment: 1 } } }));
  }
  renew(tx: Transaction, values: unknown[]) { return tx.execute(`UPDATE jobs SET lease_until=TIMESTAMPADD(MICROSECOND,?,UTC_TIMESTAMP(3)) WHERE ${fence}`, values); }
  retry(tx: Transaction, values: unknown[]) { return tx.execute(`UPDATE jobs SET state=IF(? OR attempts>=max_attempts,"FAILED","PENDING"),
        available_at=TIMESTAMPADD(MICROSECOND,?,UTC_TIMESTAMP(3)),last_error_code=?,lease_owner=NULL,lease_token=NULL,lease_until=NULL WHERE ${fence}`, values); }
}
