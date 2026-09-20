import { Module } from '@nestjs/common';
import { ModerationRetentionRepository } from './moderation-retention.repository.js';
import { ModerationRetentionService } from './moderation-retention.service.js';
@Module({ providers: [ModerationRetentionRepository, ModerationRetentionService], exports: [ModerationRetentionService] })
export class ModerationRetentionModule {}
