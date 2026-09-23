import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SongAddRequestStatus } from '@prisma/client';

export class SongAddRequestRequesterDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  nickname: string;

  @ApiPropertyOptional()
  profileImageUrl?: string;
}

export class SongAddRequestChannelDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  webPath?: string;

  @ApiPropertyOptional()
  profileImageUrl?: string;
}

export class SongAddRequestProcessorDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  nickname: string;
}

export class SongAddRequestApprovedSongDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  title: string;
}

export class SongAddRequestResponseDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ type: SongAddRequestRequesterDto })
  requester: SongAddRequestRequesterDto;

  @ApiProperty({ type: SongAddRequestChannelDto })
  channel: SongAddRequestChannelDto;

  @ApiProperty()
  title: string;

  @ApiProperty()
  artistName: string;

  @ApiPropertyOptional()
  albumArt?: string;

  @ApiPropertyOptional()
  karaokeUrl?: string;

  @ApiPropertyOptional()
  coverUrl?: string;

  @ApiPropertyOptional()
  originalUrl?: string;

  @ApiPropertyOptional()
  difficulty?: number;

  @ApiPropertyOptional()
  proficiency?: number;

  @ApiPropertyOptional()
  songKey?: string;

  @ApiPropertyOptional()
  bpm?: number;

  @ApiPropertyOptional()
  lyricsLink?: string;

  @ApiPropertyOptional()
  lyricsText?: string;

  @ApiPropertyOptional({ type: [String] })
  categoryNames?: string[];

  @ApiProperty({ enum: SongAddRequestStatus })
  status: SongAddRequestStatus;

  @ApiPropertyOptional({ type: SongAddRequestProcessorDto })
  processedBy?: SongAddRequestProcessorDto;

  @ApiPropertyOptional()
  processedAt?: Date;

  @ApiPropertyOptional()
  rejectionReason?: string;

  @ApiPropertyOptional({ type: SongAddRequestApprovedSongDto })
  approvedSong?: SongAddRequestApprovedSongDto;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class SongAddRequestListResponseDto {
  @ApiProperty({ type: [SongAddRequestResponseDto] })
  items: SongAddRequestResponseDto[];

  @ApiPropertyOptional({ description: '다음 페이지 커서' })
  nextCursor?: number;

  @ApiPropertyOptional({ description: 'PENDING 상태 신청 수 (채널 조회 시)' })
  pendingCount?: number;
}
