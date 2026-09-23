import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { UploadService } from './upload.service';
import { UploadController } from './upload.controller';
import { JwtOrInternalApiKeyGuard } from '../common/guards/jwt-or-internal-api-key.guard';

@Module({
  imports: [ConfigModule],
  providers: [JwtOrInternalApiKeyGuard, UploadService],
  controllers: [UploadController],
  exports: [UploadService],
})
export class UploadModule {}
