import { ApiProperty } from '@nestjs/swagger';

export class ScheduleTemplateResponseDto {
  @ApiProperty({ example: 42, description: '템플릿 ID' })
  id!: number;

  @ApiProperty({ example: 1, description: '채널 ID' })
  channelId!: number;

  @ApiProperty({ example: '기본 주간 스케줄', description: '템플릿 이름' })
  name!: string;

  @ApiProperty({ example: false, description: '채널 기본 템플릿 여부' })
  isDefault!: boolean;

  @ApiProperty({
    example: 'https://cdn.meloming.com/templates/base.png',
    description: '베이스 이미지 URL',
  })
  baseImageUrl!: string;

  @ApiProperty({ example: 1920, description: '베이스 이미지 가로 픽셀' })
  baseImageW!: number;

  @ApiProperty({ example: 1080, description: '베이스 이미지 세로 픽셀' })
  baseImageH!: number;

  @ApiProperty({
    description: '슬롯 스펙 JSON',
    example: { slots: [] },
    type: Object,
    additionalProperties: true,
  })
  templateSpec!: Record<string, unknown>;

  @ApiProperty({
    required: false,
    example: 'https://cdn.meloming.com/templates/base.psd',
    description: '원본 PSD URL',
    nullable: true,
  })
  originalPsdUrl!: string | null;

  @ApiProperty({
    required: false,
    example: 'https://cdn.meloming.com/templates/thumb.png',
    description: '썸네일 URL',
    nullable: true,
  })
  thumbnailUrl!: string | null;

  @ApiProperty({
    example: '2026-04-23T07:00:00.000Z',
    description: '생성 시각',
  })
  createdAt!: string;

  @ApiProperty({
    example: '2026-04-23T07:10:00.000Z',
    description: '수정 시각',
  })
  updatedAt!: string;
}
