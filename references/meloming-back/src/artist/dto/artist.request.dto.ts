import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateArtistDto {
  @ApiProperty({ description: '아티스트 이름', example: 'BTS' })
  @IsString()
  name: string;
}

export class UpdateArtistDto {
  @ApiProperty({ description: '아티스트 이름', example: 'BTS' })
  @IsString()
  name: string;
}
