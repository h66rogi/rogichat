import { Module } from '@nestjs/common';
import { JobsCoreService } from './jobs-core.service.js';
import { JobsRepository } from './jobs.repository.js';
@Module({ providers: [JobsRepository, JobsCoreService], exports: [JobsCoreService] })
export class JobsCoreModule {}
