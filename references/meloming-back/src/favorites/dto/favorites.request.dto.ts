import { ApiProperty } from '@nestjs/swagger';
import {
  IsOptional,
  IsInt,
  Min,
  Max,
  IsArray,
  ArrayNotEmpty,
  ArrayMaxSize,
  ArrayUnique,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class MyFavoritesQueryDto {
  @ApiProperty({
    description: '페이지 번호',
    example: 1,
    required: false,
    minimum: 1,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiProperty({
    description: '페이지당 항목 수',
    example: 20,
    required: false,
    minimum: 1,
    maximum: 500,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 20;
}

export class ReorderChannelFavoritesDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsInt({ each: true })
  @Transform(({ value }) => value.map(Number))
  channelIds: number[];
}
