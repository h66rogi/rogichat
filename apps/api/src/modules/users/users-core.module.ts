import { JobsCoreModule } from '../jobs/jobs-core.module.js';
import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { UsersCoreService } from './users-core.service.js';
import { UsersRepository } from './users.repository.js';

@Module({ imports: [JobsCoreModule, AccessModule], providers: [UsersRepository, UsersCoreService], exports: [UsersCoreService] })
export class UsersCoreModule {}
