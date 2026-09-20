import type { Receipt, RoomMembership } from './contract';

export interface SendPayload {
  readonly clientMessageId: string; readonly membershipScope: string;
  readonly intent: 'SHARED' | 'PRIVATE'; readonly recipientActorId?: string; readonly quoteId?: string;
  readonly content: Readonly<{ type: 'TEXT'; text: string }>;
}
export interface PendingCommand {
  readonly status: 'unknown'; readonly clientMessageId: string;
  readonly accountPartition: string; readonly sessionBinding: string; readonly roomId: string;
  readonly payload: Readonly<SendPayload>;
  readonly membershipGeneration: number;
}
export type CommandRecord = PendingCommand | Readonly<Receipt>;
/** Immutable records keyed by explicit intent identity, never by a payload fingerprint. */
export class SendCommands {
  private records = new Map<string, CommandRecord>();
  pending(): PendingCommand[] { return [...this.records.values()].filter((value): value is PendingCommand => value.status === 'unknown'); }
  get(id: string) { return this.records.get(id); }
  create(room: RoomMembership, accountPartition: string, sessionBinding: string, membershipGeneration: number, body: Omit<SendPayload, 'clientMessageId' | 'membershipScope'>): PendingCommand {
    const clientMessageId = crypto.randomUUID();
    const command: PendingCommand = Object.freeze({ status: 'unknown', clientMessageId, accountPartition, sessionBinding, membershipGeneration, roomId: room.roomId,
      payload: Object.freeze({ ...body, content: Object.freeze({ ...body.content }), clientMessageId, membershipScope: room.membershipScope }) });
    this.records.set(clientMessageId, command); return command;
  }
  settle(result: Receipt) {
    if (this.records.get(result.clientMessageId)?.status === 'deleted') return;
    // A terminal deletion retains no payload, message ID/version, or participant binding.
    this.records.set(result.clientMessageId, Object.freeze({ ...result }));
  }
  deleted(messageId: string) {
    for (const command of this.records.values()) if (command.status === 'committed' && command.messageId === messageId) this.settle({ clientMessageId: command.clientMessageId, status: 'deleted' });
  }
  clear() { this.records.clear(); }
}
