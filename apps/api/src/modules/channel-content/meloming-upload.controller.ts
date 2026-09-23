import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, HttpCode, Inject, Param, Post, Req, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import { AUTH_CONFIG } from '../auth/auth.tokens.js';
import { readCommandCredentials } from '../auth/auth-context.js';
import { channelDoc } from './channel-content.openapi.js';
import { MelomingUploadService } from './meloming-upload.service.js';
import type { ChannelImageUpload } from './meloming-upload.service.js';

@ApiTags('Upload/Meloming compatibility')
@Controller('v1/upload')
export class MelomingUploadController {
  constructor(
    @Inject(MelomingUploadService) private readonly uploads: MelomingUploadService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  @Post('image') @HttpCode(200)
  @UseInterceptors(FileInterceptor('image', { limits: { files: 1, fileSize: 10 * 1024 * 1024 } }))
  @channelDoc('melomingUploadImage', '원본 옷장 이미지 업로드', 'write')
  uploadImage(@Req() request: Request, @UploadedFile() file: ChannelImageUpload) {
    return this.uploads.uploadImage(readCommandCredentials(request, this.config), file);
  }

  @Get('image/:fileName') @channelDoc('melomingUploadImagePublic', '옷장 이미지 공개 조회')
  async readImage(@Param('fileName') fileName: string) {
    const { stream, bytes, contentType } = await this.uploads.readImage(fileName);
    return new StreamableFile(stream, { type: contentType, length: bytes,
      disposition: 'inline' });
  }
}
