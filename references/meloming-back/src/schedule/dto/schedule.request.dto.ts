import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Length,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export type ScheduleVisibility = 'PUBLIC' | 'PRIVATE';

export type ScheduleStatus = 'LIVE' | 'COLLAB' | 'OFF' | 'ETC' | 'TBD';

export class CreateScheduleDto {
  @ApiProperty({ example: '정기 방송', maxLength: 100 })
  @IsString()
  @Length(1, 100)
  title!: string;

  @ApiProperty({ required: false, example: '이번 주 컨텐츠 안내' })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiProperty({ example: '2025-11-01T12:00:00Z' })
  @IsDateString()
  startAt!: string;

  @ApiProperty({ required: false, example: '2025-11-01T14:00:00Z' })
  @IsOptional()
  @IsDateString()
  endAt?: string;

  @ApiProperty({ required: false, example: false })
  @IsOptional()
  @IsBoolean()
  allDay?: boolean;

  @ApiProperty({
    required: false,
    enum: ['PUBLIC', 'PRIVATE'],
    example: 'PUBLIC',
  })
  @IsOptional()
  @IsEnum(['PUBLIC', 'PRIVATE'])
  visibility?: ScheduleVisibility;

  @ApiProperty({ required: false, example: '온라인' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiProperty({ required: false, example: 'https://chzzk.naver.com/live/...' })
  @IsOptional()
  @IsUrl()
  externalUrl?: string;

  @ApiProperty({
    required: false,
    example: 'LIVE',
    enum: ['LIVE', 'COLLAB', 'OFF', 'ETC', 'TBD'],
  })
  @IsOptional()
  @IsEnum(['LIVE', 'COLLAB', 'OFF', 'ETC', 'TBD'])
  status?: ScheduleStatus;
}

export class UpdateScheduleDto {
  @ApiProperty({ required: false, example: '정기 방송(수정)', maxLength: 100 })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  title?: string;

  @ApiProperty({ required: false, example: '내용 일부 수정' })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiProperty({ required: false, example: '2025-11-01T13:00:00Z' })
  @IsOptional()
  @IsDateString()
  startAt?: string;

  @ApiProperty({ required: false, example: '2025-11-01T15:00:00Z' })
  @IsOptional()
  @IsDateString()
  endAt?: string;

  @ApiProperty({ required: false, example: true })
  @IsOptional()
  @IsBoolean()
  allDay?: boolean;

  @ApiProperty({ required: false, enum: ['PUBLIC', 'PRIVATE'] })
  @IsOptional()
  @IsEnum(['PUBLIC', 'PRIVATE'])
  visibility?: ScheduleVisibility;

  @ApiProperty({ required: false, example: '온라인' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiProperty({ required: false, example: 'https://chzzk.naver.com/live/...' })
  @IsOptional()
  @IsUrl()
  externalUrl?: string;

  @ApiProperty({
    required: false,
    example: 'LIVE',
    enum: ['LIVE', 'COLLAB', 'OFF', 'ETC', 'TBD'],
  })
  @IsOptional()
  @IsEnum(['LIVE', 'COLLAB', 'OFF', 'ETC', 'TBD'])
  status?: ScheduleStatus;
}

export class ScheduleListQueryDto {
  @ApiProperty({
    required: false,
    example: '2025-11',
    description: '월 단위 조회(KST). 제공 시 from/to 무시됨. 형식: YYYY-MM',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/)
  ym?: string;

  @ApiProperty({ required: false, example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ required: false, example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiProperty({ required: false, example: '2025-11-01T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiProperty({ required: false, example: '2025-11-30T23:59:59Z' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiProperty({ required: false, type: [Number], example: [1, 2, 3] })
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  channelIds?: number[];

  @ApiProperty({
    required: false,
    example: 'LIVE',
    enum: ['LIVE', 'COLLAB', 'OFF', 'ETC', 'TBD'],
  })
  @IsOptional()
  @IsEnum(['LIVE', 'COLLAB', 'OFF', 'ETC', 'TBD'])
  status?: ScheduleStatus;
}
