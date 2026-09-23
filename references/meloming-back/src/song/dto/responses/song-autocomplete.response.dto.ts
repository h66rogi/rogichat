import { ApiProperty } from '@nestjs/swagger';

export class SongAutocompleteItemDto {
  @ApiProperty({ description: '노래 ID', example: 123 })
  id: number;

  @ApiProperty({ description: '노래 제목', example: '폰서트' })
  title: string;

  @ApiProperty({ description: '아티스트 ID', example: 45 })
  artistId: number;

  @ApiProperty({ description: '아티스트 이름', example: '10cm' })
  artistName: string;
}

export class SongAutocompleteResponseDto {
  @ApiProperty({
    description: '자동완성 노래 목록',
    type: [SongAutocompleteItemDto],
  })
  suggestions: SongAutocompleteItemDto[];
}
