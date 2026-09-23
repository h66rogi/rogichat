import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { CommandCredentials, SessionCredentials } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';
import { ApiError } from '../auth/auth-primitives.js';
import { ChannelContentRepository } from './channel-content.repository.js';
import { nextChannelContentId } from './channel-content-id.js';
import { LiveSessionService } from './upstream/live-session.service.js';

function identifier(value: unknown) {
  if (value !== undefined && value !== 'hurogi' && value !== '1') throw new ApiError('NOT_FOUND', 404);
}
function positive(value: unknown, fallback: number, max: number) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d{0,3}$/.test(value)) throw new ApiError('INVALID_REQUEST', 400);
  return Math.min(Number(value),max);
}

@Injectable()
export class MelomingLiveSessionService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ChannelContentRepository) private readonly repository: ChannelContentRepository) {}

  private async source(tx: Parameters<Parameters<Transactions['write']>[0]>[0], ownerId: string, roomId: string) {
    let alias = await tx.prisma.melomingUserAlias.findUnique({ where: { userId: ownerId }, select: { id: true } });
    if (!alias) alias = await tx.prisma.melomingUserAlias.create({ data: {
      id: await nextChannelContentId(tx.prisma), userId: ownerId,
    }, select: { id: true } });
    return new LiveSessionService(tx.prisma,roomId,ownerId,alias.id);
  }

  start(credentials: CommandCredentials, raw: Record<string, unknown>, value: unknown) {
    identifier(raw.identifier);
    if (Object.keys(raw).some(key => key !== 'identifier') || !value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('INVALID_REQUEST', 400);
    const body = value as Record<string, unknown>;
    if (Object.keys(body).some(key => !['platform','practiceMode'].includes(key)) ||
      (body.platform !== undefined && body.platform !== 'SOOP') ||
      (body.practiceMode !== undefined && typeof body.practiceMode !== 'boolean')) throw new ApiError('INVALID_REQUEST', 400);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const roomId = await this.repository.requireOwner(tx, actor.userId);
      await this.repository.lockPrimary(tx);
      return (await this.source(tx,actor.userId,roomId)).startSession({ platform: 'SOOP', practiceMode: body.practiceMode === true });
    });
  }

  active(credentials: SessionCredentials, raw: Record<string, unknown>) {
    identifier(raw.identifier);
    if (Object.keys(raw).some(key => key !== 'identifier')) throw new ApiError('INVALID_REQUEST', 400);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const roomId = await this.repository.requireOwner(tx, actor.userId);
      return (await this.source(tx,actor.userId,roomId)).getActiveSession();
    });
  }

  publicActive(credentials: SessionCredentials, raw: Record<string, unknown>) {
    identifier(raw.identifier);
    if (raw.identifier === undefined || Object.keys(raw).some(key => key !== 'identifier')) throw new ApiError('INVALID_REQUEST', 400);
    return this.transactions.write(async tx => {
      const channel = await this.repository.primary(tx);
      let ownerViewer = false;
      if (credentials.token) {
        const actor = await this.auth.require(tx, credentials, true);
        ownerViewer = actor.userId === channel.ownerId;
      }
      if (!channel.ownerId) return { sessionId: null, isLive: false, settings: null, queueCount: 0 };
      return (await this.source(tx,channel.ownerId,channel.roomId)).getPublicActiveSession(ownerViewer);
    });
  }

  end(credentials: CommandCredentials, sessionId: number) {
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const roomId = await this.repository.requireOwner(tx, actor.userId);
      await this.repository.lockPrimary(tx);
      return (await this.source(tx,actor.userId,roomId)).endSession(sessionId);
    });
  }

  history(credentials: SessionCredentials, raw: Record<string, unknown>) {
    identifier(raw.identifier);
    if (Object.keys(raw).some(key => !['identifier','page','limit'].includes(key))) throw new ApiError('INVALID_REQUEST', 400);
    const page = positive(raw.page,1,1000), limit = positive(raw.limit,10,50);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const roomId = await this.repository.requireOwner(tx, actor.userId);
      return (await this.source(tx,actor.userId,roomId)).getSessionHistory(page,limit);
    });
  }

  detail(credentials: SessionCredentials, sessionId: number) {
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const roomId = await this.repository.requireOwner(tx, actor.userId);
      return (await this.source(tx,actor.userId,roomId)).getSessionDetail(sessionId);
    });
  }
}
