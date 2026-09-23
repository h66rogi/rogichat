import { ApiProperty } from '@nestjs/swagger';

export class SerperVideoItemDto {
  @ApiProperty({
    description: '영상 제목',
    example: 'BTS - Dynamite (Official MV)',
  })
  title: string;

  @ApiProperty({
    description: 'YouTube 영상 URL',
    example: 'https://www.youtube.com/watch?v=gdZLi9oWNZg',
  })
  link: string;

  @ApiProperty({
    description: '설명/스니펫',
    required: false,
    example: 'BTS (방탄소년단) Dynamite Official MV...',
  })
  snippet?: string;

  @ApiProperty({
    description: '썸네일 이미지 URL',
    required: false,
    example: 'https://i.ytimg.com/vi/gdZLi9oWNZg/hqdefault.jpg',
  })
  imageUrl?: string;

  @ApiProperty({
    description: '재생 시간',
    required: false,
    example: '3:24',
  })
  duration?: string;

  @ApiProperty({
    description: '채널명',
    required: false,
    example: 'HYBE LABELS',
  })
  channel?: string;

  @ApiProperty({
    description: '업로드 일자/상대 시간',
    required: false,
    example: '3 years ago',
  })
  date?: string;

  @ApiProperty({
    description: '소스 (YouTube 등)',
    required: false,
    example: 'YouTube',
  })
  source?: string;

  @ApiProperty({
    description: '검색 결과 내 순서',
    required: false,
    example: 1,
  })
  position?: number;
}

class SerperVideoSearchParametersDto {
  @ApiProperty({ description: '검색어', example: 'Dynamite BTS MR' })
  q: string;

  @ApiProperty({ description: '국가 코드', example: 'kr', required: false })
  gl?: string;

  @ApiProperty({ description: '언어 코드', example: 'ko', required: false })
  hl?: string;

  @ApiProperty({ description: '검색 타입', example: 'videos', required: false })
  type?: string;

  @ApiProperty({ description: '검색 엔진', example: 'google', required: false })
  engine?: string;

  @ApiProperty({ description: '검색 결과 수', example: 20, required: false })
  num?: number;
}

export class SerperVideoResponseDto {
  @ApiProperty({ type: SerperVideoSearchParametersDto, required: false })
  searchParameters?: SerperVideoSearchParametersDto;

  @ApiProperty({ type: [SerperVideoItemDto], description: 'YouTube 영상 목록' })
  videos: SerperVideoItemDto[];

  @ApiProperty({ required: false, description: 'API 크레딧' })
  credits?: number;
}
