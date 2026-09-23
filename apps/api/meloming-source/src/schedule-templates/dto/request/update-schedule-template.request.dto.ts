import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
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

/**
 * PATCH용 DTO.
 *
 * 필드 처리 규약:
 * - non-null 컬럼 (name, isDefault, baseImageUrl, baseImageW, baseImageH, templateSpec):
 *   undefined → 미변경. null 명시 → 400 Bad Request.
 *   (`@ValidateIf((o) => o.<field> !== undefined)` + non-null 검증자 조합으로 강제)
 * - nullable 컬럼 (originalPsdUrl, thumbnailUrl):
 *   undefined → 미변경. null 명시 → DB clear(null 저장).
 *   (`@IsOptional()` 유지하고 타입에 `| null` 포함)
 */
export class UpdateScheduleTemplateRequestDto {
  @ApiProperty({
    required: false,
    example: '봄 시즌 스케줄',
    description: '템플릿 이름 (null 금지)',
    maxLength: 100,
  })
  @ValidateIf((o: UpdateScheduleTemplateRequestDto) => o.name !== undefined)
  @IsString()
  @Length(1, 100)
  name?: string;

  @ApiProperty({
    required: false,
    example: true,
    description: '채널 기본 템플릿 여부 (null 금지)',
  })
  @ValidateIf(
    (o: UpdateScheduleTemplateRequestDto) => o.isDefault !== undefined,
  )
  @IsBoolean()
  isDefault?: boolean;

  @ApiProperty({
    required: false,
    example: 'https://cdn.meloming.com/templates/spring.png',
    description: '베이스 이미지 URL (null 금지)',
    maxLength: 500,
  })
  @ValidateIf(
    (o: UpdateScheduleTemplateRequestDto) => o.baseImageUrl !== undefined,
  )
  @IsUrl({ require_tld: false })
  @Length(1, 500)
  baseImageUrl?: string;

  @ApiProperty({
    required: false,
    example: 1920,
    description: '베이스 이미지 가로 픽셀 (null 금지)',
  })
  @ValidateIf(
    (o: UpdateScheduleTemplateRequestDto) => o.baseImageW !== undefined,
  )
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20000)
  baseImageW?: number;

  @ApiProperty({
    required: false,
    example: 1080,
    description: '베이스 이미지 세로 픽셀 (null 금지)',
  })
  @ValidateIf(
    (o: UpdateScheduleTemplateRequestDto) => o.baseImageH !== undefined,
  )
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20000)
  baseImageH?: number;

  @ApiProperty({
    required: false,
    description: '슬롯 스펙 JSON. 구조 검증 없이 그대로 저장/반환 (null 금지)',
    example: { slots: [] },
    type: Object,
    additionalProperties: true,
  })
  @ValidateIf(
    (o: UpdateScheduleTemplateRequestDto) => o.templateSpec !== undefined,
  )
  @IsObject()
  templateSpec?: Record<string, unknown>;

  @ApiProperty({
    required: false,
    example: 'https://cdn.meloming.com/templates/spring.psd',
    description: '원본 PSD URL. null 전송 시 DB에서 clear',
    maxLength: 500,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf(
    (o: UpdateScheduleTemplateRequestDto) => o.originalPsdUrl !== null,
  )
  @IsUrl({ require_tld: false })
  @Length(1, 500)
  originalPsdUrl?: string | null;

  @ApiProperty({
    required: false,
    example: 'https://cdn.meloming.com/templates/spring-thumb.png',
    description: '썸네일 URL. null 전송 시 DB에서 clear',
    maxLength: 500,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((o: UpdateScheduleTemplateRequestDto) => o.thumbnailUrl !== null)
  @IsUrl({ require_tld: false })
  @Length(1, 500)
  thumbnailUrl?: string | null;
}
