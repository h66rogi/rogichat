import { SendCommands } from './commands';
import type { RoomMembership, ServerMessage } from './contract';
import type { ChatDrafts } from './drafts';
import type { ChatComposerTarget } from './types';

export interface ComposerStore {
  getComposer(): { drafts: ChatDrafts; target: ChatComposerTarget | null };
  saveComposer(drafts: ChatDrafts, target: ChatComposerTarget | null, epoch: number): void;
}
export type MessageHint = Pick<ServerMessage, 'createdAt' | 'version' | 'counterpart' | 'allowedActions'>;
export const authorityKey = (room: RoomMembership) => JSON.stringify([room.membershipScope, room.authorizationRevision, room.actorId, room.role, room.mode]);
/** One browser-session room: parked data has no storage, network or render authority. */
export const MAX_PARKED_ROOMS = 4;
export const MAX_PARKED_DRAFTS = 32;
export const MAX_PARKED_BYTES = 2 * 1024 * 1024;
export class ChatMemory {
  readonly commands = new SendCommands();
  active = false;
  drafts: ChatDrafts = {};
  target: ChatComposerTarget | null = null;
  epoch = 0;
  lease = 0;
  authority: string | null = null;
  recipients: string | null = null;
  hints = new Map<string, MessageHint>();
  membershipScope: string | null = null;
  membershipGeneration = 0;
  activate() { this.active = true; return ++this.lease; }
  park() {
    this.active = false; this.lease++;
  }
  scrubAccess() { this.commands.scrub(); this.clearComposer(); this.authority = null; this.recipients = null; this.membershipScope = null; this.membershipGeneration++; }
  clearComposer() { this.drafts = {}; this.target = null; this.hints.clear(); this.epoch++; }
  clearAll() { this.active = false; this.commands.clear(); this.clearComposer(); this.authority = null; this.recipients = null; this.membershipScope = null; this.membershipGeneration++; }
}
let current: { accountPartition: string; sessionBinding: string; rooms: Map<string, ChatMemory> } | null = null;
export function forgetChatMemory() {
  if (current) for (const memory of current.rooms.values()) { memory.clearAll(); memory.lease++; }
  current = null;
}
/** Same-account relogin is still a different session; never migrate its queued data. */
export function sessionChatMemory(accountPartition: string, sessionBinding: string, roomId: string): ChatMemory {
  if (!current || current.accountPartition !== accountPartition || current.sessionBinding !== sessionBinding) {
    forgetChatMemory(); current = { accountPartition, sessionBinding, rooms: new Map() };
  }
  let memory = current.rooms.get(roomId);
  if (!memory) {
    if (current.rooms.size >= MAX_PARKED_ROOMS) {
      const parked = [...current.rooms.entries()].find(([, value]) => !value.active);
      if (!parked) throw new Error('CHAT_MEMORY_CAPACITY');
      parked[1].clearAll(); parked[1].lease++; current.rooms.delete(parked[0]);
    }
    memory = new ChatMemory(); current.rooms.set(roomId, memory); }
  return memory;
}
