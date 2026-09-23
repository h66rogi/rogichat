import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UploadModule } from '../upload/upload.module';
import { ScheduleTemplatesController } from './schedule-templates.controller';
import { ScheduleTemplatesService } from './schedule-templates.service';
import { PsdParserService } from './services/psd-parser.service';
import { ThumbnailService } from './services/thumbnail.service';

@Module({
  imports: [PrismaModule, UploadModule],
  providers: [ScheduleTemplatesService, PsdParserService, ThumbnailService],
  controllers: [ScheduleTemplatesController],
  exports: [ScheduleTemplatesService],
})
export class ScheduleTemplatesModule {}
