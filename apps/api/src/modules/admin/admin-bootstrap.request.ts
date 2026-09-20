import { fstatSync, readFileSync } from 'node:fs';
import { object } from '../auth/auth-primitives.js';
import { identifier } from '../../common/validation/identifier.js';
import { loginIdValue, passwordValue } from '../auth/password/password.dto.js';
import { nickname } from '../access/access.policy.js';
interface Base { version: 1; environment: 'qa' | 'production'; requestId: string; operatorUserId: string; expectedSubject: string }
export type AdminBootstrapRequest = Base & ({ scope: 'ADMIN_TEST_ACCESS' } | { scope: 'REVIEWER_ACCOUNT'; targetUserId: string; loginId: string; password: string; nickname: string; expiresAt: string } | { scope: 'REVIEWER_REVOKE'; targetUserId: string });
export function adminBootstrapRequest(value: unknown): AdminBootstrapRequest {
  const r = object(value, ['version', 'environment', 'requestId', 'operatorUserId', 'expectedSubject', 'scope', 'targetUserId', 'loginId', 'password', 'nickname', 'expiresAt']);
  if (r.version !== 1 || !['qa', 'production'].includes(String(r.environment)) || typeof r.expectedSubject !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/.test(r.expectedSubject)) throw new Error('invalid_admin_request');
  const base: Base = { version: 1, environment: r.environment as Base['environment'], requestId: identifier(r.requestId), operatorUserId: identifier(r.operatorUserId), expectedSubject: r.expectedSubject };
  const extra = ['targetUserId', 'loginId', 'password', 'nickname', 'expiresAt'];
  if (r.scope === 'ADMIN_TEST_ACCESS' && extra.every(k => r[k] === undefined)) return { ...base, scope: r.scope };
  if (r.scope === 'REVIEWER_REVOKE' && extra.slice(1).every(k => r[k] === undefined) && r.targetUserId !== base.operatorUserId) return { ...base, scope: r.scope, targetUserId: identifier(r.targetUserId) };
  if (r.scope !== 'REVIEWER_ACCOUNT' || typeof r.expiresAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.expiresAt) || !Number.isFinite(Date.parse(r.expiresAt))) throw new Error('invalid_admin_request');
  if (new Date(r.expiresAt).toISOString() !== r.expiresAt) throw new Error('invalid_admin_request');
  if (identifier(r.targetUserId) === base.operatorUserId) throw new Error('invalid_admin_request');
  return { ...base, scope: r.scope, targetUserId: identifier(r.targetUserId), loginId: loginIdValue(r.loginId), password: passwordValue(r.password), nickname: nickname(r.nickname), expiresAt: r.expiresAt };
}
// No argv/env/pipe/TTY credential payload. A protected regular fd is supplied by
// the private deployment operator; no request fields are ever printed.
export function readAdminBootstrapRequest(fd = 0) {
  const stat = fstatSync(fd);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size < 2 || stat.size > 4096 || stat.mode & 0o077 || stat.uid !== 0 && stat.uid !== process.getuid?.()) throw new Error('invalid_admin_request_file');
  const raw = readFileSync(fd);
  try { if (raw.length > 4096) throw new Error('invalid_admin_request_file'); return adminBootstrapRequest(JSON.parse(raw.toString('utf8'))); }
  finally { raw.fill(0); }
}
