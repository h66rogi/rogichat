import { Inject, Injectable } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import { Transactions } from '../../infrastructure/database/transactions.js';
import { DATABASE } from '../../infrastructure/database/database.tokens.js';
import type { Database } from '../../infrastructure/database/database.js';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { IdentityGuardService } from '../auth/identity-guard.service.js';
import { RoomStateService } from '../rooms/room-state.service.js';
import { DefaultRoomRepository } from './default-room.repository.js';
import type { DefaultRoomConfig } from './default-room.config.js';
import { DEFAULT_ROOM_ID } from './default-room.config.js';
export const DEFAULT_ROOM_CONFIG = Symbol('DEFAULT_ROOM_CONFIG');
export const DEFAULT_ROOM_AUTH = Symbol('DEFAULT_ROOM_AUTH');
@Injectable()
export class DefaultRoomService implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private pending?: Promise<void>;
  private stopped = false;
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(DATABASE) private readonly database: Database,
    @Inject(DefaultRoomRepository) private readonly repository: DefaultRoomRepository,
    @Inject(RoomStateService) private readonly rooms: RoomStateService,
    @Inject(IdentityGuardService) private readonly guards: IdentityGuardService,
    @Inject(DEFAULT_ROOM_CONFIG) private readonly config: DefaultRoomConfig,
    @Inject(DEFAULT_ROOM_AUTH) private readonly auth: Pick<AuthConfig, 'identityGuardKey'>) {}
  async provision(catalogOnly = false) {
    if (!(await this.database.check()).ready) return 'unavailable' as const;
    return this.transactions.write(async tx => {
      const binding = await this.repository.claim(tx, this.config.roomId ?? DEFAULT_ROOM_ID);
      if (this.config.roomId && binding.room_id !== this.config.roomId) throw new Error('default_room_conflict');
      const subject = this.config.expectedSubject;
      const digest = subject && this.auth.identityGuardKey ? createHmac('sha256', this.auth.identityGuardKey).update(`default-room:${subject}`).digest() : null;
      if (subject && !digest) throw new Error('default_room_configuration');
      if (binding.owner_subject_digest && digest && !Buffer.from(binding.owner_subject_digest).equals(digest)) throw new Error('default_room_conflict');
      if (binding.owner_bound) return 'bound' as const; // Never reopen/restore a changed or deleted room.
      let room = await this.repository.room(tx, binding.room_id);
      if (room && binding.created) throw new Error('default_room_conflict'); // Never adopt an unrelated preexisting room.
      if (!room) {
        await this.rooms.createRoom(tx, '후로기', 'FAN', binding.room_id);
        await this.repository.reserve(tx, binding.room_id);
        room = await this.repository.room(tx, binding.room_id);
      }
      if (!room || room.name !== '후로기' || room.mode !== 'FAN' || room.status !== 'CLOSED' || room.owner_member_id) throw new Error('default_room_conflict');
      if (catalogOnly) return 'awaiting_owner' as const;
      if (!subject || !digest) return 'awaiting_owner' as const;
      await this.repository.bindSpec(tx, digest);
      await this.guards.check(tx, Buffer.from(subject), this.auth.identityGuardKey);
      const owner = await this.repository.owner(tx, subject);
      if (!owner) return 'awaiting_owner' as const;
      await this.repository.activate(tx, binding.room_id, owner);
      const actor = await this.rooms.joinRoom(tx, binding.room_id, owner);
      await this.repository.finish(tx, binding.room_id, owner, actor, randomUUID());
      return 'bound' as const;
    });
  }
  async onApplicationBootstrap() {
    // Nest awaits this barrier before HTTP listen/ready. The same barrier is
    // invoked by the official migration initialization command.
    if (await this.provision(true) === 'unavailable') throw new Error('default_room_initialization_unavailable');
    this.tick();
  }
  private tick = () => {
    this.pending = this.provision().then(state => { if (state === 'bound') this.stopped = true; }, () => { process.stderr.write('default_room_bootstrap_unavailable\n'); }).finally(() => {
      if (!this.stopped) { this.timer = setTimeout(this.tick, 10000); this.timer.unref(); }
    });
  };
  async onModuleDestroy() { this.stopped = true; clearTimeout(this.timer); await this.pending; }
}
