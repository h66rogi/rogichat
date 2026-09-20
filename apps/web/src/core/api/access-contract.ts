import { exact, uuid } from '../../features/chat/contract';

export interface AccountCapabilities { chat: boolean; admin: { enabled: boolean; manageTestAccess: boolean; manageReviewers: boolean }; password: { enabled: boolean } }
export interface RoomCapabilities { effectiveRole: 'FAN' | 'MEMBER' | 'STREAMER'; canSendShared: boolean; canSendToOwner: boolean; canReadFanInbox: boolean; canPublish: boolean; canModerate: boolean; temporaryStreamer: null | { grantId: string; expiresAt: string } }
export interface TestGrant { grantId: string; roomId: string; expiresAt: string; revokedAt: string | null; createdAt: string }
function flag(value: unknown): boolean { if (typeof value !== 'boolean') throw new Error('INVALID_CAPABILITIES'); return value; }
function timestamp(value: unknown): string { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('INVALID_TIMESTAMP'); return value; }
export function parseAccountCapabilities(value: unknown): AccountCapabilities {
  const data = exact(value, ['chat', 'admin', 'password']);
  const admin = exact(data.admin, ['enabled', 'manageTestAccess', 'manageReviewers']);
  const password = exact(data.password, ['enabled']);
  return { chat: flag(data.chat), admin: { enabled: flag(admin.enabled), manageTestAccess: flag(admin.manageTestAccess), manageReviewers: flag(admin.manageReviewers) }, password: { enabled: flag(password.enabled) } };
}
export function parseRoomCapabilities(value: unknown): RoomCapabilities {
  const data = exact(value, ['effectiveRole', 'canSendShared', 'canSendToOwner', 'canReadFanInbox', 'canPublish', 'canModerate', 'temporaryStreamer']);
  if (!['FAN', 'MEMBER', 'STREAMER'].includes(data.effectiveRole as string)) throw new Error('INVALID_ROLE');
  const temporary = data.temporaryStreamer === null ? null : exact(data.temporaryStreamer, ['grantId', 'expiresAt']);
  return { effectiveRole: data.effectiveRole as RoomCapabilities['effectiveRole'], canSendShared: flag(data.canSendShared), canSendToOwner: flag(data.canSendToOwner), canReadFanInbox: flag(data.canReadFanInbox), canPublish: flag(data.canPublish), canModerate: flag(data.canModerate), temporaryStreamer: temporary && { grantId: uuid(temporary.grantId), expiresAt: timestamp(temporary.expiresAt) } };
}
export function parseGrants(value: unknown): { grants: TestGrant[]; next: string | null } {
  const data = exact(value, ['grants', 'next']);
  if (!Array.isArray(data.grants) || data.grants.length > 100) throw new Error('INVALID_GRANTS');
  const grants = data.grants.map(value => {
    const grant = exact(value, ['grantId', 'roomId', 'expiresAt', 'revokedAt', 'createdAt']);
    return { grantId: uuid(grant.grantId), roomId: uuid(grant.roomId), expiresAt: timestamp(grant.expiresAt), revokedAt: grant.revokedAt === null ? null : timestamp(grant.revokedAt), createdAt: timestamp(grant.createdAt) };
  });
  if (new Set(grants.map(grant => grant.grantId)).size !== grants.length) throw new Error('INVALID_GRANTS');
  return { grants, next: data.next === null ? null : uuid(data.next) };
}
