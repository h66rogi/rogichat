import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { leaseValues } from '../jobs/jobs.policy.js';
import type { JobLease } from '../jobs/jobs.policy.js';

@Injectable()
export class PushDeliveryRepository {
  intent(tx: Transaction, id: string) {
    return tx.prisma.push_deliveries.findUnique({ where: { id }, select: { id: true, subscription_id: true, room_id: true, message_id: true, subscription_generation: true, account_generation: true, preference_generation: true } });
  }
  async lockRoom(tx: Transaction, roomId: string): Promise<boolean> {
    // Explicit room-first lock before AccessService locks member/period rows.
    const rows = await tx.rows("SELECT id FROM rooms WHERE id=? AND status='ACTIVE' FOR UPDATE", [roomId]);
    return rows.length === 1;
  }
  // Last lock in domain -> job order. Acquire the row before sampling DB time:
  // MySQL UTC_TIMESTAMP is fixed at statement start, before any lock wait.
  admitLease(tx: Transaction, lease: JobLease): Promise<boolean> {
    return this.currentLease(tx, lease, 6000);
  }
  async currentLease(tx: Transaction, lease: JobLease, minimumRemainingMs = 0): Promise<boolean> {
    const [row] = await tx.rows<{ lease_until: Date | null }>(`SELECT lease_until FROM jobs WHERE id=? AND purpose=? AND generation=? AND lease_owner=? AND lease_token=? AND state='RUNNING' AND resource_id=? AND room_id <=> ? FOR UPDATE`, [...leaseValues(lease), lease.resourceId, lease.roomId]);
    if (!row?.lease_until) return false;
    const now = await tx.now();
    // Admission reserves six seconds; completion only requires an unexpired lease.
    return row.lease_until.getTime() > now.getTime() + minimumRemainingMs;
  }
}
