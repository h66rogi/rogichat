import { Controller, Get, HttpCode, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AUTH, csrf, sessionToken } from './auth-http.js';
import type { AuthRuntime } from './auth-http.js';
import { object } from './auth-core.js';
import type { Transaction } from './transactions.js';
import { enterRoom, exitRoom, identifier, listRooms, provisionRoom, setHistoryPolicy } from './rooms.js';
import { profileManifest, roomProfile, selfProfile, updateProfile } from './profiles.js';

@Controller('v1')
export class CommunityController {
  constructor(@Inject(AUTH) private readonly auth: AuthRuntime) {}
  private read<T>(request: Request, chat: boolean, run: (tx: Transaction, userId: string) => Promise<T>) {
    return this.auth.sessions.transactions.read(async tx => {
      const user = await this.auth.sessions.require(tx, sessionToken(request, this.auth.config), undefined, chat);
      return run(tx, user.userId);
    });
  }
  private write<T>(request: Request, chat: boolean, run: (tx: Transaction, userId: string) => Promise<T>) {
    const token = sessionToken(request, this.auth.config); const proof = csrf(request, this.auth.config);
    return this.auth.sessions.transactions.write(async tx => {
      const user = await this.auth.sessions.require(tx, token, proof, chat);
      return run(tx, user.userId);
    });
  }
  @Get('me/profile')
  me(@Req() request: Request) { return this.read(request, false, selfProfile); }
  @Patch('me/profile')
  update(@Req() request: Request) { return this.write(request, false, (tx, user) => updateProfile(tx, user, request.body)); }
  @Get('rooms')
  rooms(@Req() request: Request) {
    const query = object(request.query, ['after']);
    return this.read(request, true, (tx, user) => listRooms(tx, user, query.after === undefined ? undefined : identifier(query.after)));
  }
  @Post('admin/rooms') @HttpCode(201)
  provision(@Req() request: Request) { return this.write(request, true, (tx, user) => provisionRoom(tx, user, request.body)); }
  @Post('rooms/:roomId/join') @HttpCode(200)
  join(@Req() request: Request, @Param('roomId') roomId: string) {
    object(request.body, []);
    return this.write(request, true, (tx, user) => enterRoom(tx, roomId, user));
  }
  @Post('rooms/:roomId/leave') @HttpCode(204)
  leave(@Req() request: Request, @Param('roomId') roomId: string) {
    object(request.body, []);
    return this.write(request, true, (tx, user) => exitRoom(tx, roomId, user));
  }
  @Patch('rooms/:roomId/history-policy')
  policy(@Req() request: Request, @Param('roomId') roomId: string) { return this.write(request, true, (tx, user) => setHistoryPolicy(tx, roomId, user, request.body)); }
  @Get('rooms/:roomId/actors/:actorId/profile')
  profile(@Req() request: Request, @Param('roomId') roomId: string, @Param('actorId') actorId: string) {
    return this.read(request, true, async (tx, user) => ({ replace: true, profile: await roomProfile(tx, identifier(roomId), user, identifier(actorId), this.auth.config.key) }));
  }
  @Get('rooms/:roomId/profile-revisions')
  revisions(@Req() request: Request, @Param('roomId') roomId: string) {
    const query = object(request.query, ['after']);
    return this.read(request, true, (tx, user) => profileManifest(tx, identifier(roomId), user, this.auth.config.key, query.after === undefined ? undefined : identifier(query.after)));
  }
}
