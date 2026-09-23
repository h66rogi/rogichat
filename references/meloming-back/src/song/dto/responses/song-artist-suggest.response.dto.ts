import { ApiProperty } from '@nestjs/swagger';

export class SongArtistSuggestionDto {
  @ApiProperty({
    description: '아티스트 ID (기존이면 제공, 새 아티스트면 null)',
    example: 12,
    nullable: true,
  })
  artistId: number | null;

  @ApiProperty({ description: '아티스트 이름', example: '10cm' })
  artistName: string;

  @ApiProperty({ description: '기존 아티스트 여부', example: true })
  isExisting: boolean;

  @ApiProperty({ description: '매칭된 곡 수', example: 3, required: false })
  matchCount?: number;
}

export class SongArtistSuggestResponseDto {
  @ApiProperty({
    description: '아티스트 추천 목록',
    type: [SongArtistSuggestionDto],
  })
  suggestions: SongArtistSuggestionDto[];

  @ApiProperty({
    description: '기존 매칭이 없을 때 새 아티스트 추가 권장 여부',
    example: true,
  })
  canCreateNew: boolean;
}
