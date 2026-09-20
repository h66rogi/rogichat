import { ApiTags } from '@nestjs/swagger';
import { profileDocs } from './dto/profile.openapi.js';
import { Controller, Get, Inject, Param, Patch, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readCommandCredentials, readSessionCredentials } from '../auth/auth-context.js';
import { object } from '../auth/auth-primitives.js';
import { identifier } from '../../common/validation/identifier.js';
import { updateProfileInput } from './dto/update-profile.dto.js';
import { UsersService } from './users.service.js';

@ApiTags('Profiles')
@Controller('v1')
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService, @Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}
  @Get('me/profile')
  @profileDocs.me()
  me(@Req() request: Request) { return this.users.self(readSessionCredentials(request, this.config)); }
  @Patch('me/profile')
  @profileDocs.update()
  update(@Req() request: Request) { return this.users.update(readCommandCredentials(request, this.config), updateProfileInput(request.body)); }
  @Get('rooms/:roomId/actors/:actorId/profile')
  @profileDocs.profile()
  profile(@Req() request: Request, @Param('roomId') roomId: string, @Param('actorId') actorId: string) {
    return this.users.profile(readSessionCredentials(request, this.config), identifier(roomId), identifier(actorId));
  }
  @Get('rooms/:roomId/profile-revisions')
  @profileDocs.revisions()
  revisions(@Req() request: Request, @Param('roomId') roomId: string) {
    const query = object(request.query, ['after']);
    return this.users.revisions(readSessionCredentials(request, this.config), identifier(roomId), query.after === undefined ? undefined : identifier(query.after));
  }
}
