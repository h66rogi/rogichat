import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const MR_VIDEO_MAX_BYTES = 5 * 1024 * 1024 * 1024;
export const MR_VIDEO_PART_SIZE_BYTES = 64 * 1024 * 1024;
export const MR_VIDEO_PART_CONCURRENCY = 4;

export class InitiateSongMrVideoMultipartDto {
  @ApiProperty({ description: '원본 파일명', example: 'mr-video.mp4' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fileName!: string;

  @ApiProperty({ description: '영상 MIME type', example: 'video/mp4' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  contentType!: string;

  @ApiProperty({
    description: '파일 크기(byte). 최대 5GB',
    minimum: 1,
    maximum: MR_VIDEO_MAX_BYTES,
  })
  @IsInt()
  @Min(1)
  @Max(MR_VIDEO_MAX_BYTES)
  fileSizeBytes!: number;
}

export class SongMrVideoMultipartInitResponseDto {
  key!: string;
  uploadId!: string;
  partSizeBytes!: number;
  maxSizeBytes!: number;
  concurrency!: number;
}

export class SignSongMrVideoMultipartPartDto {
  @ApiProperty({ description: 'init 응답의 S3 key' })
  @IsString()
  @IsNotEmpty()
  key!: string;

  @ApiProperty({ description: 'init 응답의 S3 multipart uploadId' })
  @IsString()
  @IsNotEmpty()
  uploadId!: string;

  @ApiProperty({ description: 'S3 multipart part number', minimum: 1, maximum: 10000 })
  @IsInt()
  @Min(1)
  @Max(10000)
  partNumber!: number;
}

export class SongMrVideoMultipartPartUrlResponseDto {
  partNumber!: number;
  url!: string;
}

export class CompleteSongMrVideoMultipartPartDto {
  @ApiProperty({ description: 'S3 multipart part number', minimum: 1, maximum: 10000 })
  @IsInt()
  @Min(1)
  @Max(10000)
  partNumber!: number;

  @ApiProperty({ description: 'S3 UploadPart 응답 ETag' })
  @IsString()
  @IsNotEmpty()
  etag!: string;
}

export class CompleteSongMrVideoMultipartDto {
  @ApiProperty({ description: 'init 응답의 S3 key' })
  @IsString()
  @IsNotEmpty()
  key!: string;

  @ApiProperty({ description: 'init 응답의 S3 multipart uploadId' })
  @IsString()
  @IsNotEmpty()
  uploadId!: string;

  @ApiProperty({
    description: '파일 크기(byte). init 당시 클라이언트 파일 크기',
    minimum: 1,
    maximum: MR_VIDEO_MAX_BYTES,
  })
  @IsInt()
  @Min(1)
  @Max(MR_VIDEO_MAX_BYTES)
  fileSizeBytes!: number;

  @ApiProperty({ type: [CompleteSongMrVideoMultipartPartDto] })
  @IsArray()
  @ArrayMaxSize(10000)
  @ValidateNested({ each: true })
  @Type(() => CompleteSongMrVideoMultipartPartDto)
  parts!: CompleteSongMrVideoMultipartPartDto[];
}

export class AbortSongMrVideoMultipartDto {
  @ApiProperty({ description: 'init 응답의 S3 key' })
  @IsString()
  @IsNotEmpty()
  key!: string;

  @ApiProperty({ description: 'init 응답의 S3 multipart uploadId' })
  @IsString()
  @IsNotEmpty()
  uploadId!: string;
}

export class SongMrVideoResponseDto {
  id!: number;
  mrVideoUrl!: string | null;
  mrVideoKey!: string | null;

  @ApiPropertyOptional({ description: 'S3 HeadObject 기준 최종 파일 크기' })
  fileSizeBytes?: number | null;
}
