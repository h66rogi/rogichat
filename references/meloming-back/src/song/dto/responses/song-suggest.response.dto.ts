import { ApiProperty } from '@nestjs/swagger';

export class SongSuggestionDto {
  @ApiProperty({ description: '노래 ID', example: 123 })
  id: number;

  @ApiProperty({ description: '채널 ID', example: 1 })
  channelId: number;

  @ApiProperty({ description: '노래 제목', example: '폰서트' })
  title: string;

  @ApiProperty({ description: '아티스트 이름', example: '10cm' })
  artistName: string;

  @ApiProperty({
    description: '매칭 점수 (0~1, 높을수록 좋음)',
    example: 0.92,
  })
  score: number;
}

export class SongSuggestResponseDto {
  @ApiProperty({
    description: '추천 노래 목록 (점수 순 정렬)',
    type: [SongSuggestionDto],
  })
  suggestions: SongSuggestionDto[];
}
