import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export type RecurringScheduleStatus = 'LIVE' | 'OFF';

export class RecurringScheduleItemDto {
  @ApiProperty({ example: 0, description: '요일 (0=일 ~ 6=토)' })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @ApiProperty({ example: '정기 방송', maxLength: 100 })
  @IsString()
  @Length(1, 100)
  title!: string;

  @ApiProperty({
    example: '20:00',
    required: false,
    description: 'HH:mm (LIVE일 때 필수, OFF는 null)',
  })
  @ValidateIf((o) => o.status === 'LIVE')
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'startTime must be in HH:mm format',
  })
  startTime?: string | null;

  @ApiProperty({ enum: ['LIVE', 'OFF'], example: 'LIVE' })
  @IsEnum(['LIVE', 'OFF'])
  status!: RecurringScheduleStatus;

  @ApiProperty({ example: true })
  @IsBoolean()
  isActive!: boolean;
}

export class SaveRecurringSchedulesDto {
  @ApiProperty({ type: [RecurringScheduleItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecurringScheduleItemDto)
  schedules!: RecurringScheduleItemDto[];
}
