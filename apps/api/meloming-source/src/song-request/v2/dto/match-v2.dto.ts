import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsInt, IsOptional, IsString, MaxLength, ArrayMaxSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class MatcherV2PreviewRequestDto {
  @ApiProperty({ description: '대상 채널 ID', example: 1 })
  @IsInt()
  channelId!: number;

  @ApiProperty({ description: '채팅 원문', example: '!신청 아이유 - 좋은날' })
  @IsString()
  @MaxLength(500)
  rawMessage!: string;

  @ApiPropertyOptional({
    description: '채널 requestCommand 설정. 생략 시 `!신청` 기본값',
    example: '!신청',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  requestCommand?: string;
}

export class MatcherV2BatchItemDto {
  @ApiProperty({ description: '식별용 (CSV 행 번호 등)', example: 'row-1' })
  @IsString()
  @MaxLength(64)
  id!: string;

  @ApiProperty({ description: '채팅 원문' })
  @IsString()
  @MaxLength(500)
  rawMessage!: string;
}

export class MatcherV2BatchRequestDto {
  @ApiProperty({ description: '대상 채널 ID' })
  @IsInt()
  channelId!: number;

  @ApiPropertyOptional({ description: '채널 requestCommand 설정' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  requestCommand?: string;

  @ApiProperty({
    description: '채팅 메시지 배열 (최대 500건)',
    type: [MatcherV2BatchItemDto],
  })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => MatcherV2BatchItemDto)
  items!: MatcherV2BatchItemDto[];
}
