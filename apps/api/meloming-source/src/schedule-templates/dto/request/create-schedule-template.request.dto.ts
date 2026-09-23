import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDefined,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateScheduleTemplateRequestDto {
  @ApiProperty({
    example: 1,
    description: '템플릿이 속한 채널 ID',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  channelId!: number;

  @ApiProperty({
    example: '기본 주간 스케줄',
    description: '템플릿 이름',
    maxLength: 100,
  })
  @IsString()
  @Length(1, 100)
  name!: string;

  @ApiProperty({
    required: false,
    example: false,
    description: '채널 기본 템플릿 여부',
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiProperty({
    example: 'https://cdn.meloming.com/templates/base.png',
    description: '베이스 이미지 URL',
    maxLength: 500,
  })
  @IsUrl({ require_tld: false })
  @Length(1, 500)
  baseImageUrl!: string;

  @ApiProperty({ example: 1920, description: '베이스 이미지 가로 픽셀' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20000)
  baseImageW!: number;

  @ApiProperty({ example: 1080, description: '베이스 이미지 세로 픽셀' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20000)
  baseImageH!: number;

  @ApiProperty({
    description: '슬롯 스펙 JSON. 구조 검증 없이 그대로 저장/반환',
    example: { slots: [] },
    type: Object,
    additionalProperties: true,
  })
  @IsDefined()
  @IsObject()
  templateSpec!: Record<string, unknown>;

  @ApiProperty({
    required: false,
    example: 'https://cdn.meloming.com/templates/base.psd',
    description:
      '원본 PSD URL. 미전송(undefined) 또는 명시적 null 허용 (DB 저장 시 null)',
    maxLength: 500,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf(
    (o: CreateScheduleTemplateRequestDto) => o.originalPsdUrl !== null,
  )
  @IsUrl({ require_tld: false })
  @Length(1, 500)
  originalPsdUrl?: string | null;

  @ApiProperty({
    required: false,
    example: 'https://cdn.meloming.com/templates/thumb.png',
    description:
      '썸네일 URL. 미전송(undefined) 시 백엔드 자동 생성, 명시적 null 시 자동 생성 스킵',
    maxLength: 500,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((o: CreateScheduleTemplateRequestDto) => o.thumbnailUrl !== null)
  @IsUrl({ require_tld: false })
  @Length(1, 500)
  thumbnailUrl?: string | null;
}
