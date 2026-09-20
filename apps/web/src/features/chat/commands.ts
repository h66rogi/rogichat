import type { Receipt, RoomMembership } from './contract';

export interface SendPayload {
  readonly clientMessageId: string; readonly membershipScope: string;
  readonly intent: 'SHARED' | 'PRIVATE'; readonly recipientActorId?: string; readonly quoteId?: string;
  readonly content: Readonly<{ type: 'TEXT'; text: string } | { type: 'PHOTO' | 'VIDEO'; assetIds: readonly string[] } | { type: 'STICKER'; stickerId: string }>;
}
export interface PendingCommand {
  readonly status: 'unknown'; readonly clientMessageId: string;
  readonly accountPartition: string; readonly sessionBinding: string; readonly roomId: string;
  readonly payload: Readonly<SendPayload>;
  readonly membershipGeneration: number;
}
export interface QuarantinedCommand {
  readonly status: 'unknown'; readonly clientMessageId: string;
  readonly accountPartition: string; readonly sessionBinding: string; readonly roomId: string;
  readonly membershipScope: string; readonly membershipGeneration: number;
}
export type UnknownCommand = PendingCommand | QuarantinedCommand;
export type CommandRecord = UnknownCommand | Readonly<Receipt>;
/** Immutable records keyed by explicit intent identity, never by a payload fingerprint. */
export class SendCommands {
  private records = new Map<string, CommandRecord>();
  pending(): UnknownCommand[] { return [...this.records.values()].filter((value): value is UnknownCommand => value.status === 'unknown'); }
  get(id: string) { return this.records.get(id); }
  create(room: RoomMembership, accountPartition: string, sessionBinding: string, membershipGeneration: number, body: Omit<SendPayload, 'clientMessageId' | 'membershipScope'>): PendingCommand {
    if (this.records.size >= 256) {
      const settled = [...this.records.values()].find(value => value.status !== 'unknown');
      if (settled) this.records.delete(settled.clientMessageId);
      else throw new Error('COMMAND_CAPACITY');
    }
    const clientMessageId = crypto.randomUUID();
    const command: PendingCommand = Object.freeze({ status: 'unknown', clientMessageId, accountPartition, sessionBinding, membershipGeneration, roomId: room.roomId,
      payload: Object.freeze({ ...body, content: Object.freeze('assetIds' in body.content ? { ...body.content, assetIds: Object.freeze([...body.content.assetIds]) } : { ...body.content }), clientMessageId, membershipScope: room.membershipScope }) });
    this.records.set(clientMessageId, command); return command;
  }
  /** Import only records already fenced and sanitized by durable storage. Never populate composer drafts. */
  restore(command: CommandRecord) {
    const prior = this.records.get(command.clientMessageId);
    if (prior?.status === 'deleted') return;
    if (this.records.size >= 256 && !prior) throw new Error('COMMAND_CAPACITY');
    if (command.status === 'unknown' && 'payload' in command) {
      const content = command.payload.content;
      this.records.set(command.clientMessageId, Object.freeze({ ...command, payload: Object.freeze({ ...command.payload,
        content: Object.freeze('assetIds' in content ? { ...content, assetIds: Object.freeze([...content.assetIds]) } : { ...content }) }) }));
    } else this.records.set(command.clientMessageId, Object.freeze({ ...command }));
  }
  settle(result: Receipt) {
    const prior = this.records.get(result.clientMessageId);
    if (!prior || prior.status === 'deleted') return;
    // A terminal deletion retains no payload, message ID/version, or participant binding.
    this.records.set(result.clientMessageId, Object.freeze({ ...result }));
  }
  /** Confirmed access loss erases replayable content, retaining only receipt lookup identity. */
  quarantine(matches: (command: PendingCommand) => boolean = () => true) {
    for (const command of this.records.values()) {
      if (command.status !== 'unknown' || !('payload' in command) || !matches(command)) continue;
      this.records.set(command.clientMessageId, Object.freeze({ status: 'unknown', clientMessageId: command.clientMessageId,
        accountPartition: command.accountPartition, sessionBinding: command.sessionBinding, roomId: command.roomId,
        membershipScope: command.payload.membershipScope, membershipGeneration: command.membershipGeneration }));
    }
  }
  scrub() { this.quarantine(); for (const [id, value] of this.records) if (value.status === 'committed') this.records.delete(id); }
  clear() { this.records.clear(); }
}
