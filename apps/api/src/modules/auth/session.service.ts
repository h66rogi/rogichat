import { Injectable } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import { ApiError, digest, equalDigest, secret } from './auth-primitives.js';
import type { Principal } from './auth-primitives.js';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { SessionRepository } from './session.repository.js';
import type { SessionBinding } from './session.repository.js';
import { nativeClientId } from './auth-context.js';
import type { NativeClientId } from './auth-context.js';

// Session policy only: no driver access, implicit transaction, or cached principal.
@Injectable()
export class SessionService {
  constructor(private readonly repository: SessionRepository, private readonly audience: string, private readonly key: Buffer) {}

  csrf(token: string): string { return createHmac('sha256', this.key).update(`csrf:${this.audience}:${token}`).digest('base64url'); }

  // Local persistence namespace only: never accept this value as authorization.
  // Stable across transports, relogin and revocation generations; rotating the
  // configured key invalidates old namespaces instead of mixing account data.
  accountPartition(userId: string): string {
    return createHmac('sha256', this.key).update('account-partition:v1:')
      .update(JSON.stringify([this.audience, userId])).digest('base64url');
  }

  async nativeBinding(tx: Transaction, sessionId: string, clientId: NativeClientId) {
    const row = await this.repository.boundNative(tx, sessionId, this.audience, clientId);
    if (!row) throw new ApiError('LINK_SESSION_CHANGED', 401);
    if (Number(row.recent) !== 1) throw new ApiError('RECENT_AUTH_REQUIRED', 403);
    if (row.terms_version !== '2026-09-20') throw new ApiError('TERMS_REQUIRED', 403);
    return { userId: row.user_id, generation: BigInt(row.membership_generation) };
  }

  async nativeSession(tx: Transaction, token: string, clientId: NativeClientId) {
    const principal = await this.require(tx, token, undefined, false, { transport: 'NATIVE', clientId });
    const account = await this.repository.nativeAccount(tx, principal.sessionId, principal.userId, this.audience, clientId);
    if (!account) throw new ApiError('UNAUTHENTICATED', 401);
    const profile = account.user.profile;
    if (!profile) throw new ApiError('AUTH_UNAVAILABLE', 503);
    const avatar = profile.avatar;
    const avatarAssetId = avatar && avatar.owner_user_id === principal.userId && avatar.kind === 'AVATAR' && avatar.room_id === null && avatar.state === 'READY' && avatar.deleted_at === null ? avatar.id : null;
    const accountGeneration = createHmac('sha256', this.key).update('native-account:v1:').update(JSON.stringify([this.audience, principal.userId, String(account.user.membership_generation), principal.soopLinked])).digest('base64url');
    return { authenticated: true, account: { userId: principal.userId, nickname: profile.nickname, avatarAssetId },
      soopLinkStatus: principal.soopLinked ? 'VERIFIED' : 'REQUIRED', onboardingState: principal.soopLinked ? 'READY' : 'SOOP_LINK_REQUIRED',
      expiresAt: account.expires_at.toISOString(), accountGeneration, accountPartition: this.accountPartition(principal.userId), capabilities: { chat: principal.soopLinked } };
  }

  async issue(tx: Transaction, userId: string): Promise<{ token: string; csrf: string }> {
    const token = secret(); const csrf = this.csrf(token);
    await this.repository.insert(tx, { id: randomUUID(), userId, tokenDigest: digest(token), csrfDigest: digest(csrf), audience: this.audience });
    return { token, csrf };
  }

  // Internal issuance port only. A verified login/link flow owns account checks
  // and this same transaction; there is deliberately no public mint endpoint.
  async issueNative(tx: Transaction, userId: string, clientId: NativeClientId): Promise<{ token: string; expiresAt: string }> {
    nativeClientId(clientId);
    const token = secret();
    const expiresAt = await this.repository.insert(tx, { id: randomUUID(), userId, tokenDigest: digest(token), csrfDigest: digest(secret()), audience: this.audience }, { transport: 'NATIVE', clientId });
    return { token, expiresAt: expiresAt.toISOString() };
  }

  // Reads and subsequent projections MUST use this same handle; current locking read for commands.
  async require(tx: Transaction, token: string | undefined, csrf?: string, chat = false, binding: SessionBinding = { transport: 'WEB' }): Promise<Principal> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ApiError('UNAUTHENTICATED', 401);
    if (binding.transport === 'NATIVE') {
      nativeClientId(binding.clientId);
      if (csrf !== undefined) throw new ApiError('INVALID_REQUEST', 400);
    } else if (binding.transport !== 'WEB' || binding.clientId !== undefined) throw new ApiError('INVALID_REQUEST', 400);
    const session = await this.repository.findCurrent(tx, digest(token), this.audience, binding);
    if (!session || session.status !== 'ACTIVE') throw new ApiError('UNAUTHENTICATED', 401);
    if (csrf !== undefined && !equalDigest(csrf, session.csrf_digest)) throw new ApiError('FORBIDDEN', 403);
    const soopLinked = session.soop_status === 'VERIFIED';
    if (chat && !soopLinked) throw new ApiError('SOOP_LINK_REQUIRED', 403);
    return { userId: session.user_id, sessionId: session.id, soopLinked };
  }

  async revoke(tx: Transaction, token: string | undefined, csrf: string): Promise<void> {
    const principal = await this.require(tx, token, csrf);
    await this.repository.revoke(tx, principal.sessionId);
  }
}
