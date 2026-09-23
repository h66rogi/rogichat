import { IsArray, IsInt, ArrayMinSize, ArrayMaxSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CalculatePricesDto {
  @ApiProperty({
    description: '가격을 계산할 곡 ID 목록 (최대 100개)',
    example: [1, 2, 3],
    type: [Number],
  })
  @IsArray()
  @IsInt({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  songIds: number[];
}
