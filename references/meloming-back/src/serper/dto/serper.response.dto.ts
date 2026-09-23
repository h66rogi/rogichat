import { ApiProperty } from '@nestjs/swagger';

export class SerperImageItemDto {
  @ApiProperty({ description: '이미지 제목', example: 'Dynamite' })
  title: string;

  @ApiProperty({
    description: '이미지 URL',
    example: 'https://example.com/image.jpg',
  })
  imageUrl: string;

  @ApiProperty({
    description: '이미지 너비',
    example: 100,
  })
  imageWidth?: number;

  @ApiProperty({
    description: '이미지 높이',
    example: 100,
  })
  imageHeight?: number;

  @ApiProperty({
    description: '이미지 썸네일 URL',
    example: 'https://example.com/image.jpg',
  })
  thumbnailUrl?: string;

  @ApiProperty({
    required: false,
    description: '이미지 썸네일 너비',
    example: 100,
  })
  thumbnailWidth?: number;

  @ApiProperty({
    required: false,
    description: '이미지 썸네일 높이',
    example: 100,
  })
  thumbnailHeight?: number;

  @ApiProperty({
    required: false,
    description: '출처',
    example: 'https://example.com',
  })
  source?: string;

  @ApiProperty({
    required: false,
    description: '도메인',
    example: 'https://example.com',
  })
  domain?: string;

  @ApiProperty({
    required: false,
    description: '링크',
    example: 'https://example.com',
  })
  link?: string;

  @ApiProperty({
    required: false,
    description: '구글 URL',
    example: 'https://example.com',
  })
  googleUrl?: string;

  @ApiProperty({
    required: false,
    description: '순서',
    example: 1,
  })
  position?: number;
}

class SerperSearchParametersDto {
  @ApiProperty({
    description: '검색어',
    example: 'Dynamite',
  })
  q: string;

  @ApiProperty({
    description: '국가 코드',
    example: 'KR',
    required: false,
  })
  gl?: string;

  @ApiProperty({
    description: '언어 코드',
    example: 'ko',
    required: false,
  })
  hl?: string;

  @ApiProperty({
    description: '검색 타입',
    example: 'image',
    required: false,
  })
  type?: string;

  @ApiProperty({
    description: '검색 엔진',
    example: 'duckduckgo images',
    required: false,
  })
  engine?: string;

  @ApiProperty({
    description: '검색 결과 수',
    example: 10,
    required: false,
  })
  num?: number;
}

export class SerperResponseDto {
  @ApiProperty({ type: SerperSearchParametersDto })
  searchParameters: SerperSearchParametersDto;

  @ApiProperty({ type: [SerperImageItemDto], description: '이미지 목록' })
  images: SerperImageItemDto[];

  @ApiProperty({ required: false, description: 'API 크레딧' })
  credits?: number;

  @ApiProperty({
    required: false,
    description: '허용된 도메인 목록',
    example: ['https://example.com', 'https://example.com/image.jpg'],
  })
  allowable_urls?: string[];
}
