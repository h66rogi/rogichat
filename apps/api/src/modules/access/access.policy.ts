export interface AccessFacts {
  accountActive: boolean;
  chatEnabled: boolean;
  roomId: string;
  roomActive: boolean;
  memberId: string;
  memberRoomId: string;
  memberActive: boolean;
  periodActive: boolean;
  visibleFrom: bigint;
  role: 'FAN' | 'MEMBER' | 'STREAMER';
  ownerMemberId: string | null;
  delegated?: boolean;
}
export interface MessageFacts {
  roomId: string;
  streamId: string;
  streamRoomId: string;
  streamKind: 'ROOM_SHARED' | 'RESTRICTED';
  order: bigint;
  deleted: boolean;
  moderated: boolean;
  deletionRootBlocked: boolean;
  grant: { memberId: string; roomId: string; streamId: string; canRead: boolean; active: boolean } | null;
}
const present = (actor: AccessFacts): boolean => actor.accountActive && actor.chatEnabled && actor.roomActive && actor.memberActive && actor.periodActive && actor.roomId === actor.memberRoomId;
const available = (actor: AccessFacts, message: MessageFacts): boolean => present(actor) && actor.roomId === message.roomId && message.roomId === message.streamRoomId && !message.deleted && !message.moderated && !message.deletionRootBlocked;

// Facts must be loaded with content from the SAME fresh writer snapshot; do not authorize from cached facts.
export function canReadMessage(actor: AccessFacts, message: MessageFacts): boolean {
  if (!available(actor, message) || message.order < actor.visibleFrom) return false;
  return message.streamKind === 'ROOM_SHARED' || actor.delegated === true || Boolean(message.grant && message.grant.active && message.grant.canRead && message.grant.memberId === actor.memberId && message.grant.roomId === actor.roomId && message.grant.streamId === message.streamId);
}

export function canPublishSource(actor: AccessFacts, message: MessageFacts): boolean {
  // Owner publication power is intentionally independent of normal read grant and historical read boundary.
  return available(actor, message) && actor.role === 'STREAMER' && (actor.ownerMemberId === actor.memberId || actor.delegated === true && message.order >= actor.visibleFrom) && message.streamKind === 'RESTRICTED';
}

export function validBirthday(month: unknown, day: unknown): { month: number; day: number } | null {
  if (month === null && day === null) return null;
  if (typeof month !== 'number' || typeof day !== 'number' || !Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > [31,29,31,30,31,30,31,31,30,31,30,31][month - 1]!) throw new Error('invalid_birthday');
  return { month, day };
}

export function nickname(value: unknown): string {
  if (typeof value !== 'string') throw new Error('invalid_nickname');
  const normalized = value.normalize('NFC').trim();
  if ([...normalized].length < 1 || [...normalized].length > 40 || /[\p{Cc}\p{Cf}]/u.test(normalized)) throw new Error('invalid_nickname');
  return normalized;
}
