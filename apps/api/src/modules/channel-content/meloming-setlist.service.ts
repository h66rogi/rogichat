import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { CommandCredentials, SessionCredentials } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';
import { ApiError } from '../auth/auth-primitives.js';
import { ChannelContentRepository } from './channel-content.repository.js';
import { SessionSetlistService } from './upstream/session-setlist.service.js';

function pagination(raw: Record<string, unknown>) {
  const values = ['page', 'limit'].map(key => {
    const value = raw[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !/^[1-9]\d{0,3}$/.test(value)) throw new ApiError('INVALID_REQUEST', 400);
    return Number(value);
  });
  return { page: values[0] ?? 1, limit: Math.min(50, values[1] ?? 20) };
}

function identifier(raw: Record<string, unknown>) {
  if (raw.identifier !== 'hurogi' && raw.identifier !== '1') throw new ApiError('NOT_FOUND', 404);
}

@Injectable()
export class MelomingSetlistService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ChannelContentRepository) private readonly repository: ChannelContentRepository) {}

  publicList(raw: Record<string, unknown>) {
    identifier(raw);
    if (Object.keys(raw).some(key => !['identifier','page','limit','from','to'].includes(key))) throw new ApiError('INVALID_REQUEST', 400);
    const { page, limit } = pagination(raw);
    for (const key of ['from','to']) if (raw[key] !== undefined && (typeof raw[key] !== 'string' || raw[key].length > 64)) throw new ApiError('INVALID_REQUEST', 400);
    return this.transactions.read(async tx => {
      const channel = await this.repository.primary(tx);
      return new SessionSetlistService(tx.prisma, channel.roomId).getPublicSetlists(page, limit,
        { ...(raw.from !== undefined ? { from: raw.from as string } : {}),
          ...(raw.to !== undefined ? { to: raw.to as string } : {}) });
    });
  }

  availability(raw: Record<string, unknown>) {
    identifier(raw);
    if (Object.keys(raw).some(key => key !== 'identifier')) throw new ApiError('INVALID_REQUEST', 400);
    return this.transactions.read(async tx => {
      const channel = await this.repository.primary(tx);
      return new SessionSetlistService(tx.prisma, channel.roomId).getPublicSetlistAvailability();
    });
  }

  detail(sessionId: number, raw: Record<string, unknown>) {
    identifier(raw);
    if (Object.keys(raw).some(key => key !== 'identifier')) throw new ApiError('INVALID_REQUEST', 400);
    return this.transactions.read(async tx => {
      const channel = await this.repository.primary(tx);
      return new SessionSetlistService(tx.prisma, channel.roomId).getPublicSetlistDetail(sessionId);
    });
  }

  manage(credentials: SessionCredentials, raw: Record<string, unknown>) {
    identifier(raw);
    if (Object.keys(raw).some(key => !['identifier','page','limit'].includes(key))) throw new ApiError('INVALID_REQUEST', 400);
    const { page, limit } = pagination(raw);
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const roomId = await this.repository.requireOwner(tx, actor.userId);
      return new SessionSetlistService(tx.prisma, roomId).getManageSetlists(page, limit);
    });
  }

  visibility(credentials: CommandCredentials, sessionId: number, raw: Record<string, unknown>, body: unknown) {
    identifier(raw);
    if (Object.keys(raw).some(key => key !== 'identifier') || !body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== 1 || !['PUBLIC','PRIVATE'].includes((body as { visibility?: string }).visibility ?? '')) throw new ApiError('INVALID_REQUEST', 400);
    const visibility = (body as { visibility: 'PUBLIC' | 'PRIVATE' }).visibility;
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const roomId = await this.repository.requireOwner(tx, actor.userId);
      return new SessionSetlistService(tx.prisma, roomId).updateSetlistVisibility(sessionId, visibility);
    });
  }
}
