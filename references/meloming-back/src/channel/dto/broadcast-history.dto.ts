import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class BroadcastHistoryQueryDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number = 30;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class BroadcastHistoryItemDto {
  @ApiProperty() id: number;
  @ApiProperty() platform: string;
  @ApiProperty() startedAt: string;
  @ApiProperty({ nullable: true }) endedAt: string | null;
  @ApiProperty() status: string;
  @ApiProperty({ nullable: true }) durationMinutes: number | null;
}

export class BroadcastHistoryResponseDto {
  @ApiProperty() channelId: number;
  @ApiProperty({ type: [BroadcastHistoryItemDto] })
  items: BroadcastHistoryItemDto[];
  @ApiProperty() total: number;
  @ApiProperty() days: number;
  @ApiProperty() limit: number;
}
