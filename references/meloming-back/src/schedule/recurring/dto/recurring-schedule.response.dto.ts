import { ApiProperty } from '@nestjs/swagger';

export class RecurringScheduleResponseDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  channelId!: number;

  @ApiProperty({ description: '요일 (0=일 ~ 6=토)' })
  dayOfWeek!: number;

  @ApiProperty()
  title!: string;

  @ApiProperty({ nullable: true, description: 'HH:mm (휴방 시 null)' })
  startTime!: string | null;

  @ApiProperty({ enum: ['LIVE', 'OFF'] })
  status!: 'LIVE' | 'OFF';

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class RecurringSchedulesListResponseDto {
  @ApiProperty({ type: [RecurringScheduleResponseDto] })
  items!: RecurringScheduleResponseDto[];
}
