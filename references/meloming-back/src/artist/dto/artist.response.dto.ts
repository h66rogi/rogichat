import { ApiProperty } from '@nestjs/swagger';

class ArtistUserBriefDto {
  @ApiProperty({ example: 10 })
  id: number;

  @ApiProperty({ example: 'john' })
  nickname: string;
}

class ArtistChannelBriefDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'My Music Book' })
  name: string;

  @ApiProperty({ type: ArtistUserBriefDto })
  user: ArtistUserBriefDto;
}

export class ArtistListItemDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'BTS', description: '아티스트 표시명' })
  name: string;

  @ApiProperty({ example: 1 })
  channelId: number;

  @ApiProperty({
    example: '2024-08-01T12:34:56.000Z',
    nullable: true,
    description: '생성 일시',
  })
  createdAt: Date | null;

  @ApiProperty({ example: 12, description: '해당 아티스트의 노래 수' })
  songCount: number;

  @ApiProperty({ type: ArtistChannelBriefDto })
  channel: ArtistChannelBriefDto;
}

export class ArtistDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'BTS' })
  name: string;

  @ApiProperty({ example: 1 })
  channelId: number;

  @ApiProperty({ example: '2024-08-01T12:34:56.000Z', nullable: true })
  createdAt: Date | null;
}

export class DeleteArtistResponseDto {
  @ApiProperty({ example: '가수가 삭제되었습니다.' })
  message: string;
}
