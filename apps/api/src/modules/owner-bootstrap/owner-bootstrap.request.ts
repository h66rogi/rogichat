import { createHash, createHmac } from 'node:crypto';
import { constants, closeSync, fstatSync, openSync, readFileSync } from 'node:fs';
import { identifier } from '../../common/validation/identifier.js';
import { provisionRoomInput } from '../rooms/dto/room.dto.js';

export interface OwnerBootstrapRequest {
  version: 1;
  scope: 'INITIAL_OWNER';
  environment: 'qa' | 'production';
  requestId: string;
  ownerUserId: string;
  expectedProvider: 'soop';
  expectedSubject: string;
  roomId: string;
  name: string;
  mode: 'FAN';
  historyPolicy: 'ALL_AVAILABLE' | 'SINCE_JOIN';
  grantCreator: boolean;
  grantManageRooms: boolean;
}
function digestUuid(hex: string): string {
  const variant = ((Number.parseInt(hex[16]!, 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
// Reserved global initial-owner receipt, not an account or a product fixture.
export const BOOTSTRAP_RECEIPT = digestUuid(createHash('sha256').update('rogichat:initial-owner:v1').digest('hex'));
export function bootstrapSpecId(request: OwnerBootstrapRequest, key: Buffer): string {
  return digestUuid(createHmac('sha256', key).update('rogichat:initial-owner:spec:v1:').update(JSON.stringify(request)).digest('hex'));
}
export function ownerBootstrapRequest(value: unknown): OwnerBootstrapRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_owner_bootstrap');
  const r = value as Record<string, unknown>;
  if (Object.keys(r).sort().join(',') !== 'environment,expectedProvider,expectedSubject,grantCreator,grantManageRooms,historyPolicy,mode,name,ownerUserId,requestId,roomId,scope,version' ||
    r.version !== 1 || r.scope !== 'INITIAL_OWNER' || !['qa', 'production'].includes(String(r.environment)) ||
    r.expectedProvider !== 'soop' || typeof r.expectedSubject !== 'string' || !Buffer.byteLength(r.expectedSubject) ||
    Buffer.byteLength(r.expectedSubject) > 191 || r.expectedSubject !== Buffer.from(r.expectedSubject).toString('utf8') ||
    typeof r.grantCreator !== 'boolean' || typeof r.grantManageRooms !== 'boolean' || r.mode !== 'FAN') throw new Error('invalid_owner_bootstrap');
  const room = provisionRoomInput({ name: r.name, ownerUserId: r.ownerUserId, mode: r.mode, historyPolicy: r.historyPolicy });
  if (room.name !== r.name) throw new Error('invalid_owner_bootstrap');
  const requestId = identifier(r.requestId), roomId = identifier(r.roomId);
  if ([requestId, roomId, room.ownerUserId].includes(BOOTSTRAP_RECEIPT) || new Set([requestId, roomId, room.ownerUserId]).size !== 3) throw new Error('invalid_owner_bootstrap');
  return { version: 1, scope: 'INITIAL_OWNER', environment: r.environment as 'qa' | 'production', requestId,
    ownerUserId: room.ownerUserId, expectedProvider: 'soop', expectedSubject: r.expectedSubject, roomId,
    name: room.name, mode: 'FAN', historyPolicy: room.historyPolicy, grantCreator: r.grantCreator, grantManageRooms: r.grantManageRooms };
}
/** A redirected private regular file on fd 0 only: no tty, pipe, argv or env payload. */
export function readOwnerBootstrapRequest(fd = 0): OwnerBootstrapRequest {
  const stat = fstatSync(fd);
  if (!stat.isFile() || stat.size < 2 || stat.size > 8192 || (stat.mode & 0o077) !== 0 ||
    (stat.uid !== 0 && stat.uid !== process.getuid?.())) throw new Error('invalid_owner_bootstrap_input');
  const raw = readFileSync(fd);
  if (raw.length > 8192) throw new Error('invalid_owner_bootstrap_input');
  return ownerBootstrapRequest(JSON.parse(raw.toString('utf8')));
}
/** Validate protected config files before existing config parsers read them. */
export function requirePrivateFile(path: string | undefined): void {
  if (!path) throw new Error('invalid_owner_bootstrap_config');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 16384 || (stat.mode & 0o077) !== 0 ||
      (stat.uid !== 0 && stat.uid !== process.getuid?.())) throw new Error('invalid_owner_bootstrap_config');
  } finally { closeSync(fd); }
}
