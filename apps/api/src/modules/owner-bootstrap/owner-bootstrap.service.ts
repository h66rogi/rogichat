import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import { DATABASE } from '../../infrastructure/database/database.tokens.js';
import type { Database } from '../../infrastructure/database/database.js';
import { IdentityGuardService } from '../auth/identity-guard.service.js';
import { RoomStateService } from '../rooms/room-state.service.js';
import { OwnerBootstrapRepository } from './owner-bootstrap.repository.js';
import { BOOTSTRAP_RECEIPT, bootstrapSpecId, ownerBootstrapRequest } from './owner-bootstrap.request.js';

export const OWNER_BOOTSTRAP_CONFIG = Symbol('OWNER_BOOTSTRAP_CONFIG');
export interface OwnerBootstrapConfig { environment: string; identityGuardKey: Buffer }
function conflict(): never { throw new Error('owner_bootstrap_conflict'); }

@Injectable()
export class OwnerBootstrapService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(DATABASE) private readonly database: Database,
    @Inject(OwnerBootstrapRepository) private readonly repository: OwnerBootstrapRepository,
    @Inject(IdentityGuardService) private readonly guards: IdentityGuardService,
    @Inject(RoomStateService) private readonly rooms: RoomStateService,
    @Inject(OWNER_BOOTSTRAP_CONFIG) private readonly config: OwnerBootstrapConfig) {}

  async provision(value: unknown) {
    const r = ownerBootstrapRequest(value);
    if (r.environment !== this.config.environment || this.config.identityGuardKey.length !== 32) conflict();
    if (!(await this.database.check()).ready) throw new Error('owner_bootstrap_unavailable');
    const specId = bootstrapSpecId(r, this.config.identityGuardKey);
    if ([BOOTSTRAP_RECEIPT, r.requestId, r.roomId, r.ownerUserId].includes(specId)) conflict();
    return this.transactions.write(async tx => {
      await this.repository.claim(tx, r);
      await this.guards.check(tx, Buffer.from(r.expectedSubject), this.config.identityGuardKey);
      await this.repository.lockTargets(tx, r);
      const s = await this.repository.snapshot(tx, r, specId);
      if (!s.user || s.user.status !== 'ACTIVE' || s.user.soop?.status !== 'VERIFIED' ||
        !Buffer.from(s.user.soop.provider_subject).equals(Buffer.from(r.expectedSubject)) ||
        !s.user.soop.verified_at || s.deletion || s.intents) conflict();
      const singleton = s.receipts.find(row => row.id === BOOTSTRAP_RECEIPT);
      if (!singleton || singleton.actor_user_id !== r.ownerUserId || singleton.room_id !== r.roomId || singleton.action !== 'INITIAL_OWNER_BOOTSTRAP') conflict();
      const request = s.receipts.find(row => row.id === r.requestId), spec = s.receipts.find(row => row.id === specId);
      if (request || spec || s.room) {
        if (!request || !spec || request.action !== 'INITIAL_OWNER_REQUEST' || spec.action !== 'INITIAL_OWNER_SPEC' ||
          [request, spec].some(row => row.actor_user_id !== r.ownerUserId || row.room_id !== r.roomId)) conflict();
        const room = s.room, owner = room?.owner, period = owner?.active_period;
        if (!room || room.name !== r.name || room.mode !== 'FAN' || room.status !== 'ACTIVE' || room.history_policy !== r.historyPolicy ||
          room.policy_version !== 1 || room.join_policy !== 'OPEN_AUTHENTICATED' || !room.counter || room.streams.length !== 1 ||
          !owner || room.owner_member_id !== owner.id || owner.user_id !== r.ownerUserId || owner.role !== 'STREAMER' || owner.status !== 'ACTIVE' ||
          !period || period.room_id !== r.roomId || period.member_id !== owner.id || period.left_at !== null ||
          period.history_policy !== r.historyPolicy || period.policy_version !== 1 || !s.user.creator?.enabled ||
          (r.grantManageRooms && !s.user.admin?.manage_rooms)) conflict();
        return { status: 'already_applied' as const, roomId: room.id };
      }
      // This command is deliberately initial-only. It never adopts an existing
      // room or selects among candidates, even when names/owners happen to match.
      if (s.otherRooms || s.otherCreators || s.otherManagers || (!r.grantCreator && !s.user.creator?.enabled)) conflict();
      await this.repository.grant(tx, r);
      const result = await this.rooms.createOwnedRoom(tx, r.name, r.mode, r.historyPolicy, r.ownerUserId, r.roomId);
      await this.repository.receipt(tx, r, specId);
      return { status: 'applied' as const, roomId: result.roomId };
    });
  }
}
