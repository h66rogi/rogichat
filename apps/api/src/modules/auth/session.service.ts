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
