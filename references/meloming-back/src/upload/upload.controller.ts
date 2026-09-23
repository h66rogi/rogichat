import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  HttpStatus,
  HttpCode,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { UploadService } from './upload.service';
import {
  UploadResponseDto,
  UploadFileResponseDto,
} from './dto/upload.response.dto';
import { UploadImageDto, UploadFileDto } from './dto/upload.request.dto';
import { JwtOrInternalApiKeyGuard } from '../common/guards/jwt-or-internal-api-key.guard';

@ApiTags('Upload')
@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('image')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(JwtOrInternalApiKeyGuard)
  @ApiOperation({
    summary: '이미지 업로드',
    description: '이미지 파일을 S3에 업로드하고 URL을 반환합니다.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: '이미지 파일 업로드',
    type: UploadImageDto,
  })
  @ApiResponse({
    status: 200,
    description: '이미지 업로드 성공',
    type: UploadResponseDto,
  })
  @ApiResponse({ status: 400, description: '잘못된 파일 형식 또는 크기' })
  @UseInterceptors(FileInterceptor('image'))
  async uploadImage(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }), // 10MB
          new FileTypeValidator({
            fileType: /^image\/(jpeg|jpg|png|gif|webp)$/,
          }),
        ],
      }),
    )
    file: Express.Multer.File,
  ): Promise<UploadResponseDto> {
    return this.uploadService.uploadImage(file);
  }

  @Post('file')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(JwtOrInternalApiKeyGuard)
  @ApiOperation({
    summary: '파일 업로드',
    description: '파일을 S3에 업로드하고 URL을 반환합니다.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: '파일 업로드',
    type: UploadFileDto,
  })
  @ApiResponse({
    status: 200,
    description: '파일 업로드 성공',
    type: UploadFileResponseDto,
  })
  @ApiResponse({ status: 400, description: '잘못된 파일 형식 또는 크기' })
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }), // 10MB
        ],
      }),
    )
    file: Express.Multer.File,
  ): Promise<UploadFileResponseDto> {
    return this.uploadService.uploadFile(file);
  }
}
