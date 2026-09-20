import { Inject, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { Transactions } from '../../infrastructure/database/transactions.js';
import { authorizationKey } from '../../infrastructure/config/authorization-epoch.js';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { consumeRate } from '../../infrastructure/rate-limit/rate-limit.repository.js';
import { AuthService } from '../auth/auth.service.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { ApiError } from '../auth/auth-primitives.js';
import type { CommandCredentials } from '../auth/auth-context.js';
import { canonicalProfileId } from '../auth/soop-profile.contract.js';
import { UsersCoreService } from './users-core.service.js';
import { ProviderAvatarReader } from './provider-avatar-reader.js';

interface AvatarTicket { userId: string; roomId?: string; actorId?: string; expires: number; sourceHash: string }
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export function sealAvatarTicket(value: AvatarTicket, key: Buffer): string {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('rogi-provider-avatar-v1'));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
export function openAvatarTicket(value: unknown, key: Buffer, now = Date.now()): AvatarTicket {
  try {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{64,1024}$/.test(value)) throw new Error();
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from('rogi-provider-avatar-v1')); decipher.setAuthTag(bytes.subarray(12, 28));
    const ticket = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')) as AvatarTicket;
    const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
    if (!ticket || !uuid.test(ticket.userId) || !Number.isSafeInteger(ticket.expires) || ticket.expires <= now || ticket.expires > now + 60000 ||
      !/^[a-f0-9]{64}$/.test(ticket.sourceHash) || (ticket.roomId === undefined) !== (ticket.actorId === undefined) ||
      (ticket.roomId !== undefined && (!uuid.test(ticket.roomId) || !uuid.test(ticket.actorId!)))) throw new Error();
    return ticket;
  } catch { throw new ApiError('NOT_FOUND', 404); }
}

export async function fetchProviderAvatar(url: string, fetcher: typeof fetch = fetch): Promise<{ bytes: Buffer; contentType: string }> {
  if (!canonicalProfileId(url)) throw new ApiError('NOT_FOUND', 404);
  const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(5000), headers: { accept: 'image/jpeg,image/webp' } });
  const limit = 2 * 1024 * 1024, contentType = response.headers.get('content-type')?.split(';')[0]?.trim();
  if (!response.ok || !response.body || !['image/jpeg', 'image/webp'].includes(contentType ?? '') || Number(response.headers.get('content-length') ?? 0) > limit) {
    await response.body?.cancel(); throw new ApiError('MEDIA_UNAVAILABLE', 503);
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.length;
      if (length > limit) throw new ApiError('MEDIA_UNAVAILABLE', 503); chunks.push(part.value); }
  } finally { await reader.cancel(); }
  const bytes = Buffer.concat(chunks);
  if (contentType === 'image/jpeg' ? bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255 :
    bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') throw new ApiError('MEDIA_UNAVAILABLE', 503);
  return { bytes, contentType: contentType! };
}

@Injectable()
export class ProviderAvatarService {
  private readonly key: Buffer;
  private readonly reader = new ProviderAvatarReader(fetchProviderAvatar, () => new ApiError('MEDIA_UNAVAILABLE', 503));
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(UsersCoreService) private readonly users: UsersCoreService) {
    this.key = createHmac('sha256', authorizationKey(config)).update(`provider-avatar-ticket-v1:${config.audience}`).digest();
  }
  async access(credentials: CommandCredentials, roomId?: string, actorId?: string) {
    // Commit admission separately so failing ACL checks cannot roll back quota.
    const userId = await this.transactions.write(async tx => (await this.auth.require(tx, credentials, true)).userId);
    await this.rate(`issue:${userId}`);
    const ticket = await this.transactions.write(async tx => {
      const principal = await this.auth.require(tx, credentials, true);
      const url = await this.users.providerAvatar(tx, principal.userId, roomId, actorId);
      return { userId: principal.userId, ...(roomId && actorId ? { roomId, actorId } : {}), expires: Date.now() + 60000, sourceHash: sha(url) };
    });
    return { url: `${new URL(this.config.callback).origin}/v1/profile-images?ticket=${sealAvatarTicket(ticket, this.key)}`, expiresIn: 60 };
  }
  async image(value: unknown) {
    const ticket = openAvatarTicket(value, this.key);
    // Tickets are bounded bearer capabilities, not sessions. Recheck current
    // account, membership, block and profile state before each provider read.
    await this.rate(`read:${ticket.userId}`);
    const url = await this.transactions.read(tx => this.users.providerAvatar(tx, ticket.userId, ticket.roomId, ticket.actorId));
    if (sha(url) !== ticket.sourceHash) throw new ApiError('NOT_FOUND', 404);
    // Only after current authorization: same-source reads share a bounded
    // download/cache, never viewer credentials or a prior authorization result.
    try { return await this.reader.get(url); }
    catch (error) { if (error instanceof ApiError) throw error; throw new ApiError('MEDIA_UNAVAILABLE', 503); }
  }
  private async rate(scope: string) {
    const accepted = await this.transactions.write(tx => consumeRate(tx, createHmac('sha256', this.key).update(scope).digest(), 120, 60));
    if (!accepted) throw new ApiError('RATE_LIMITED', 429);
  }
}
