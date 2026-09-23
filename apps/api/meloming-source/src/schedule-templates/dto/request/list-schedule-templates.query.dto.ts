import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListScheduleTemplatesQueryDto {
  @ApiProperty({
    example: 1,
    description: '대상 채널 ID',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  channelId!: number;
}
