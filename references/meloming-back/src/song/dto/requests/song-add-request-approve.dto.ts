import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsInt,
  IsArray,
  MaxLength,
  Min,
  Max,
} from 'class-validator';

/**
 * 노래 신청 승인 시 수정된 값을 전달하기 위한 DTO
 * 모든 필드가 optional - 제공된 필드만 원본 요청 값을 덮어씀
 */
export class SongAddRequestApproveDto {
  @ApiPropertyOptional({ description: '노래 제목' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({ description: '아티스트 이름' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  artistName?: string;

  @ApiPropertyOptional({ description: '앨범 아트 URL' })
  @IsOptional()
  @IsString()
  albumArt?: string;

  @ApiPropertyOptional({ description: '노래방 URL' })
  @IsOptional()
  @IsString()
  karaokeUrl?: string;

  @ApiPropertyOptional({ description: '커버 URL' })
  @IsOptional()
  @IsString()
  coverUrl?: string;

  @ApiPropertyOptional({ description: '원곡 URL' })
  @IsOptional()
  @IsString()
  originalUrl?: string;

  @ApiPropertyOptional({ description: '난이도 (1-5)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  difficulty?: number;

  @ApiPropertyOptional({ description: '숙련도 (1-5)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  proficiency?: number;

  @ApiPropertyOptional({ description: '키' })
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
  @IsString()
  lyricsLink?: string;

  @ApiPropertyOptional({ description: '가사 텍스트' })
  @IsOptional()
  @IsString()
  lyricsText?: string;

  @ApiPropertyOptional({ description: '카테고리 이름 목록', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categoryNames?: string[];
}
