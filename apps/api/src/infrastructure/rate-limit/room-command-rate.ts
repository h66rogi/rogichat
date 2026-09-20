import { createHmac } from 'node:crypto';
import type { Transaction } from '../database/transactions.js';
import { consumeRate } from './rate-limit.repository.js';

export type RoomCommand = 'send' | 'reaction' | 'publication';
// Caller commits this transaction separately, before the authorized command transaction.
// Failed work consumes a bounded account key; arbitrary missing room UUIDs create no room keys.
export async function roomCommandRate(tx: Transaction, key: Buffer, userId: string, roomId: string, command: RoomCommand) {
  const policies = { send: [60, 30, 5], reaction: [120, 60, 10], publication: [30, 20, 5] } as const;
  const [accountLimit, minute, burst] = policies[command];
  const hash = (suffix: string) => createHmac('sha256', key).update(`${command}:${suffix}`).digest();
  if (!await consumeRate(tx, hash(`account:${userId}`), accountLimit, 60)) return false;
  const members = await tx.prisma.room_members.findMany({ where: { room_id: roomId, user_id: userId }, select: { id: true } });
  if (!members.length) return true;
  if (!await consumeRate(tx, hash(`minute:${userId}:${roomId}`), minute, 60)) return false;
  return consumeRate(tx, hash(`burst:${userId}:${roomId}`), burst, 1);
}
