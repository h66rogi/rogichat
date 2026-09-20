import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import { identifier } from '../../common/validation/identifier.js';
import { AccessService } from '../access/access.service.js';
import { ApiError } from '../auth/auth-primitives.js';
import type { SessionCredentials } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';
import { MessagesCoreService } from './messages-core.service.js';
import { MessageCommandsRepository } from './message-commands.repository.js';

export type MessageCommandDto =
  | { clientMessageId: string; status: 'committed'; messageId: string; version: string }
  | { clientMessageId: string; status: 'deleted' };

@Injectable()
export class MessageCommandsService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(MessageCommandsRepository) private readonly repository: MessageCommandsRepository,
    @Inject(MessagesCoreService) private readonly messages: MessagesCoreService) {}

  get(credentials: SessionCredentials, roomId: string, clientMessageId: string): Promise<MessageCommandDto> {
    identifier(roomId); identifier(clientMessageId);
    return this.transactions.read(async tx => {
      // Fresh authentication, membership, receipt and ACL share one read snapshot.
      // Never accept a caller-supplied account partition or sender identity.
      const principal = await this.auth.require(tx, credentials, true);
      const viewer = await this.access.requireActiveMember(tx, roomId, principal.userId);
      const receipt = await this.repository.ownReceipt(tx, roomId, viewer.id, clientMessageId);
      if (!receipt) throw new ApiError('NOT_FOUND', 404);
      // A durable terminal receipt has no body, ID or payload digest projection.
      if (receipt.deleted) return { clientMessageId, status: 'deleted' };
      const row = await this.messages.load(tx, roomId, receipt.message_id);
      if (!row || !await this.messages.readable(tx, viewer, row)) throw new ApiError('NOT_FOUND', 404);
      return { clientMessageId, status: 'committed', messageId: row.id, version: String(row.version) };
    });
  }
}
