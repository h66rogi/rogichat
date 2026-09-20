import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import { AuthService } from '../auth/auth.service.js';
import type { SessionCredentials, CommandCredentials } from '../auth/auth-context.js';
import { RoomsCoreService } from './rooms-core.service.js';
import { RoomMediaCoreService } from '../media/room-media-core.service.js';
import { PrivateRecipientsCoreService } from './private-recipients-core.service.js';

@Injectable()
export class RoomsService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(RoomsCoreService) private readonly rooms: RoomsCoreService,
    @Inject(RoomMediaCoreService) private readonly mediaPolicy: RoomMediaCoreService,
    @Inject(PrivateRecipientsCoreService) private readonly recipients: PrivateRecipientsCoreService) {}
  privateRecipients(credentials: SessionCredentials, roomId: string, after?: string) {
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      return this.recipients.list(tx, roomId, actor.userId, after);
    });
  }
  list(credentials: SessionCredentials, after?: string) {
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      return this.rooms.listRooms(tx, actor.userId, after);
    });
  }
  provision(credentials: CommandCredentials, input: unknown) {
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      return this.rooms.provisionRoom(tx, actor.userId, input);
    });
  }
  join(credentials: CommandCredentials, roomId: string) {
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      return this.rooms.enterRoom(tx, roomId, actor.userId);
    });
  }
  leave(credentials: CommandCredentials, roomId: string) {
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      return this.rooms.exitRoom(tx, roomId, actor.userId);
    });
  }
  historyPolicy(credentials: CommandCredentials, roomId: string, input: unknown) {
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      return this.rooms.setHistoryPolicy(tx, roomId, actor.userId, input);
    });
  }
  readMediaPolicy(credentials: SessionCredentials, roomId: string) {
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      return this.mediaPolicy.readRoomMediaPolicy(tx, roomId, actor.userId);
    });
  }
  updateMediaPolicy(credentials: CommandCredentials, roomId: string, input: unknown) {
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      return this.mediaPolicy.setRoomMediaPolicy(tx, roomId, actor.userId, input);
    });
  }
}
