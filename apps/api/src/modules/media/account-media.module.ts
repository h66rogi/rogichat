import { Module } from '@nestjs/common';
import { AccountMediaRepository } from './account-media.repository.js';
import { AccountMediaService } from './account-media.service.js';
@Module({ providers: [AccountMediaRepository, AccountMediaService], exports: [AccountMediaService] })
export class AccountMediaModule {}
