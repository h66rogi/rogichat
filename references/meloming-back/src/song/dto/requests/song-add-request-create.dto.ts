import {
  IsString,
  IsOptional,
  IsInt,
  IsArray,
  MaxLength,
  IsUrl,
  Min,
  Max,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SongAddRequestCreateDto {
  @ApiProperty({ description: '대상 채널 ID' })
  @IsInt()
  channelId: number;

  @ApiProperty({ description: '노래 제목', maxLength: 255 })
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiProperty({ description: '아티스트 이름', maxLength: 255 })
  @IsString()
  @MaxLength(255)
  artistName: string;

  @ApiPropertyOptional({ description: '앨범 아트 URL' })
  @IsOptional()
  @IsString()
  albumArt?: string;

  @ApiPropertyOptional({ description: '노래방 URL' })
  @IsOptional()
  @IsUrl()
  karaokeUrl?: string;

  @ApiPropertyOptional({ description: '커버 URL' })
  @IsOptional()
  @IsUrl()
  coverUrl?: string;

  @ApiPropertyOptional({ description: '원곡 URL' })
  @IsOptional()
  @IsUrl()
  originalUrl?: string;

  @ApiPropertyOptional({ description: '난이도 (1-5)', minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  difficulty?: number;

  @ApiPropertyOptional({ description: '숙련도 (1-5)', minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  proficiency?: number;

  @ApiPropertyOptional({ description: '키', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  songKey?: string;

  @ApiPropertyOptional({ description: 'BPM' })
  @IsOptional()
  @IsInt()
  @Min(1)
  bpm?: number;

  @ApiPropertyOptional({ description: '가사 링크' })
  @IsOptional()
  @IsUrl()
  lyricsLink?: string;

  @ApiPropertyOptional({ description: '가사 텍스트' })
  @IsOptional()
  @IsString()
  lyricsText?: string;

  @ApiPropertyOptional({
    description: '카테고리 이름 목록',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categoryNames?: string[];

  @ApiPropertyOptional({
    description: '앨범 아트 자동 검색 여부',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  autoSearchAlbumArt?: boolean;
}
