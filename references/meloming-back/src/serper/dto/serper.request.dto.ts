import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class SerperRequestDto {
  @ApiProperty({ description: '노래 제목', example: 'Dynamite' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ description: '아티스트명', example: 'BTS' })
  @IsString()
  @IsNotEmpty()
  artist: string;
}
