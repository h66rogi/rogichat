import { Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AUTH, csrf, sessionToken } from './auth-http.js';
import type { AuthRuntime } from './auth-http.js';
import { ApiError, object } from './auth-core.js';
import type { Transaction } from './transactions.js';
import { roomCommandRate } from './rates.js';
import type { RoomCommand } from './rates.js';
import { identifier } from './rooms.js';
import { requestPublication, publicationStatus } from './publications.js';
import { reactionEmoji, readReactions, setReaction } from './reactions.js';

@Controller('v1/rooms/:roomId')
export class InteractionsController {
  constructor(@Inject(AUTH) private readonly auth: AuthRuntime) {}
  private async mutate<T>(request: Request, roomId: string, command: RoomCommand, run: (tx: Transaction, userId: string) => Promise<T>) {
    identifier(roomId);
    const token = sessionToken(request, this.auth.config); const proof = csrf(request, this.auth.config);
    const allowed = await this.auth.sessions.transactions.write(async tx => {
      const principal = await this.auth.sessions.require(tx, token, proof, true);
      return roomCommandRate(tx, this.auth.config.key, principal.userId, roomId, command);
    });
    if (!allowed) throw new ApiError('RATE_LIMITED', 429);
    return this.auth.sessions.transactions.write(async tx => {
      const principal = await this.auth.sessions.require(tx, token, proof, true);
      return run(tx, principal.userId);
    });
  }
  private read<T>(request: Request, run: (tx: Transaction, userId: string) => Promise<T>) {
    return this.auth.sessions.transactions.read(async tx => {
      const principal = await this.auth.sessions.require(tx, sessionToken(request, this.auth.config), undefined, true);
      return run(tx, principal.userId);
    });
  }
  @Post('messages/:messageId/publications') @HttpCode(202)
  publish(@Req() request: Request, @Param('roomId') roomId: string, @Param('messageId') messageId: string) {
    object(request.body, []); identifier(messageId);
    return this.mutate(request, roomId, 'publication', (tx, user) => requestPublication(tx, roomId, user, messageId));
  }
  @Get('publications/:publicationId')
  publication(@Req() request: Request, @Param('roomId') roomId: string, @Param('publicationId') publicationId: string) {
    return this.read(request, (tx, user) => publicationStatus(tx, roomId, user, publicationId));
  }
  @Get('messages/:messageId/reactions')
  reactions(@Req() request: Request, @Param('roomId') roomId: string, @Param('messageId') messageId: string) {
    return this.read(request, (tx, user) => readReactions(tx, roomId, user, messageId));
  }
  @Put('messages/:messageId/reactions/me')
  react(@Req() request: Request, @Param('roomId') roomId: string, @Param('messageId') messageId: string) {
    const input = object(request.body, ['emoji']); const emoji = reactionEmoji(input.emoji); identifier(messageId);
    return this.mutate(request, roomId, 'reaction', (tx, user) => setReaction(tx, roomId, user, messageId, emoji));
  }
  @Delete('messages/:messageId/reactions/me') @HttpCode(200)
  unreact(@Req() request: Request, @Param('roomId') roomId: string, @Param('messageId') messageId: string) {
    object(request.body ?? {}, []); identifier(messageId);
    return this.mutate(request, roomId, 'reaction', (tx, user) => setReaction(tx, roomId, user, messageId, null));
  }
}
