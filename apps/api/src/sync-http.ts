import { Controller, Get, Inject, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AUTH, sessionToken } from './auth-http.js';
import type { AuthRuntime } from './auth-http.js';
import type { Principal } from './auth-core.js';
import type { Transaction } from './transactions.js';
import { Sync, syncInput } from './sync.js';
import type { SyncInput } from './sync.js';

@Controller('v1')
export class SyncController {
  private readonly sync: Sync;
  constructor(@Inject(AUTH) private readonly auth: AuthRuntime) { this.sync = new Sync(auth.config.key, auth.config.audience); }
  private read<T>(request: Request, operation: (tx: Transaction, principal: Principal, input: SyncInput) => Promise<T>) {
    const input = syncInput(request.query);
    return this.auth.sessions.transactions.read(async tx => {
      const principal = await this.auth.sessions.require(tx, sessionToken(request, this.auth.config), undefined, true);
      return operation(tx, principal, input);
    });
  }
  @Get('sync')
  manifest(@Req() request: Request) { return this.read(request, (tx, principal, input) => this.sync.manifest(tx, principal, input)); }
  @Get('rooms/:roomId/snapshot')
  snapshot(@Req() request: Request, @Param('roomId') roomId: string) { return this.read(request, (tx, principal, input) => this.sync.snapshot(tx, principal, roomId, input)); }
  @Get('rooms/:roomId/events')
  events(@Req() request: Request, @Param('roomId') roomId: string) { return this.read(request, (tx, principal, input) => this.sync.events(tx, principal, roomId, input)); }
  @Get('rooms/:roomId/history')
  history(@Req() request: Request, @Param('roomId') roomId: string) { return this.read(request, (tx, principal, input) => this.sync.history(tx, principal, roomId, input)); }
  @Get('rooms/:roomId/profile-sync')
  profiles(@Req() request: Request, @Param('roomId') roomId: string) { return this.read(request, (tx, principal, input) => this.sync.profiles(tx, principal, roomId, input)); }
}
