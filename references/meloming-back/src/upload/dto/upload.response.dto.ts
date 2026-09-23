import { ApiProperty } from '@nestjs/swagger';

export class UploadResponseDto {
  @ApiProperty({
    description: '업로드된 이미지의 S3 object key',
    example: '20250811/550e8400-e29b-41d4-a716-446655440000.jpg',
  })
  fileKey: string;

  @ApiProperty({
    description: '업로드된 이미지 URL',
    example:
      'https://upload.meloming.com/20250811/550e8400-e29b-41d4-a716-446655440000.jpg',
  })
  imageUrl: string;

  @ApiProperty({
    description: '파일명',
    example: '550e8400-e29b-41d4-a716-446655440000.jpg',
  })
  fileName: string;
}

export class UploadFileResponseDto {
  @ApiProperty({
    description: '업로드된 파일의 S3 object key',
    example: '20250811/550e8400-e29b-41d4-a716-446655440000.pdf',
  })
  fileKey: string;

  @ApiProperty({
    description: '업로드된 파일 URL',
    example:
      'https://upload.meloming.com/20250811/550e8400-e29b-41d4-a716-446655440000.pdf',
  })
  fileUrl: string;

  @ApiProperty({
    description: '파일명',
    example: '550e8400-e29b-41d4-a716-446655440000.pdf',
  })
  fileName: string;
}
