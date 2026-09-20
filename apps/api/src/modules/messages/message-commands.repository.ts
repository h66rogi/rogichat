import { Injectable } from '@nestjs/common';
import type { Transaction } from '../../infrastructure/database/transactions.js';

@Injectable()
export class MessageCommandsRepository {
  ownReceipt(tx: Transaction, roomId: string, actorId: string, clientMessageId: string) {
    return tx.prisma.command_receipts.findUnique({
      where: { room_id_actor_id_client_message_id: { room_id: roomId, actor_id: actorId, client_message_id: clientMessageId } },
      select: { message_id: true, deleted: true },
    });
  }
}
