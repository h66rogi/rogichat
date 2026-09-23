import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class SerperWebRequestDto {
  @ApiProperty({ description: '검색어', example: 'BTS - Dynamite 가사' })
  @IsString()
  @IsNotEmpty()
  query: string;

  @ApiProperty({
    description: '검색 결과 최대 개수 (기본 20, 최대 50)',
    required: false,
    example: 20,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  num?: number;
}
