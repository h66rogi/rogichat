import { Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AUTH, csrf, sessionToken } from './auth-http.js';
import type { AuthRuntime } from './auth-http.js';
import { ApiError, object } from './auth-core.js';
import { roomCommandRate } from './rates.js';
import { identifier } from './rooms.js';
import { deleteMessage, getMessage, sendInput, sendMessage } from './messages.js';

@Controller('v1/rooms/:roomId/messages')
export class MessagesController {
  constructor(@Inject(AUTH) private readonly auth: AuthRuntime) {}
  @Post() @HttpCode(200)
  async send(@Req() request: Request, @Param('roomId') roomId: string) {
    identifier(roomId);
    const input = sendInput(request.body);
    const token = sessionToken(request, this.auth.config); const proof = csrf(request, this.auth.config);
    // Charge in an independent commit: failed/rolled-back commands cannot refund the bucket.
    const allowed = await this.auth.sessions.transactions.write(async tx => {
      const actor = await this.auth.sessions.require(tx, token, proof, true);
      return roomCommandRate(tx, this.auth.config.key, actor.userId, roomId, 'send');
    });
    if (!allowed) throw new ApiError('RATE_LIMITED', 429);
    return this.auth.sessions.transactions.write(async tx => {
      const actor = await this.auth.sessions.require(tx, token, proof, true);
      return sendMessage(tx, roomId, actor.userId, input, this.auth.config.key);
    });
  }
  @Get(':messageId')
  get(@Req() request: Request, @Param('roomId') roomId: string, @Param('messageId') messageId: string) {
    return this.auth.sessions.transactions.read(async tx => {
      const actor = await this.auth.sessions.require(tx, sessionToken(request, this.auth.config), undefined, true);
      return getMessage(tx, roomId, actor.userId, messageId);
    });
  }
  @Post(':messageId/delete') @HttpCode(200)
  remove(@Req() request: Request, @Param('roomId') roomId: string, @Param('messageId') messageId: string) {
    object(request.body, []);
    const token = sessionToken(request, this.auth.config); const proof = csrf(request, this.auth.config);
    return this.auth.sessions.transactions.write(async tx => {
      const actor = await this.auth.sessions.require(tx, token, proof);
      return deleteMessage(tx, roomId, actor.userId, messageId);
    });
  }
}
