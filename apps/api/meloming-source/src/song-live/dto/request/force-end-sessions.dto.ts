import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { StreamPlatform } from '@prisma/client';

export class ForceEndSessionItemDto {
  @ApiProperty({ enum: StreamPlatform, example: 'CHZZK' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsEnum(StreamPlatform)
  platform: StreamPlatform;

  @ApiProperty({ example: 'abc123' })
  @IsString()
  @IsNotEmpty()
  platformChannelId: string;
}

export class ForceEndSessionsDto {
  @ApiProperty({ type: [ForceEndSessionItemDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ForceEndSessionItemDto)
  channels: ForceEndSessionItemDto[];
}
