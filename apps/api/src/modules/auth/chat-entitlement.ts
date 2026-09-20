import type { Prisma } from '../../generated/prisma/client.js';

// Reviewer access is a real, separately expiring entitlement, never SOOP status.
export function chatUser(now: Date): Prisma.usersWhereInput {
  return { status: 'ACTIVE', OR: [{ soop: { is: { status: 'VERIFIED' } } }, { reviewer_expires_at: { gt: now } },
    { identities: { some: { provider: 'apple', issuer: Buffer.from('https://appleid.apple.com'), status: 'VERIFIED', revoked_at: null } } }] };
}
// Fixed source-only aliases for existing locking/ACL-before-LIMIT exceptions.
export function chatAccountSql(user: 'u' | 'subject', soop: 's' | 'p' | 'platform' | 'subject_platform' | 'soop') {
  return `(${soop}.status='VERIFIED' OR ${user}.reviewer_expires_at>UTC_TIMESTAMP(3) OR EXISTS (SELECT 1 FROM auth_identities ai WHERE ai.user_id=${user}.id AND ai.provider='apple' AND ai.issuer=_binary'https://appleid.apple.com' AND ai.status='VERIFIED' AND ai.revoked_at IS NULL))`;
}
