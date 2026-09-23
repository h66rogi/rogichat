import { ApiProperty } from '@nestjs/swagger';

export class UploadImageDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: '업로드할 이미지 파일 (최대 10MB, jpeg/jpg/png/gif/webp)',
  })
  image: Express.Multer.File;
}

export class UploadFileDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: '업로드할 파일 (최대 10MB)',
  })
  file: Express.Multer.File;
}
