import { ApiProperty } from '@nestjs/swagger';

export class SerperWebResultItemDto {
  @ApiProperty({ description: '결과 제목', example: 'BTS - Dynamite 가사' })
  title!: string;

  @ApiProperty({
    description: '결과 URL',
    example: 'https://example.com/lyrics/dynamite',
  })
  link!: string;

  @ApiProperty({
    description: '스니펫 (요약 텍스트)',
    required: false,
    example: "Cos I, I, I'm in the stars tonight...",
  })
  snippet?: string;

  @ApiProperty({
    description: '도메인',
    required: false,
    example: 'example.com',
  })
  domain?: string;

  @ApiProperty({
    description: '게시일/상대 시간',
    required: false,
    example: '2 years ago',
  })
  date?: string;

  @ApiProperty({
    description: '검색 결과 내 순서',
    required: false,
    example: 1,
  })
  position?: number;
}

class SerperWebSearchParametersDto {
  @ApiProperty({ description: '검색어', example: 'BTS - Dynamite 가사' })
  q!: string;

  @ApiProperty({ description: '국가 코드', example: 'kr', required: false })
  gl?: string;

  @ApiProperty({ description: '언어 코드', example: 'ko', required: false })
  hl?: string;

  @ApiProperty({ description: '검색 타입', example: 'search', required: false })
  type?: string;

  @ApiProperty({ description: '검색 엔진', example: 'google', required: false })
  engine?: string;

  @ApiProperty({ description: '검색 결과 수', example: 20, required: false })
  num?: number;
}

export class SerperWebResponseDto {
  @ApiProperty({ type: SerperWebSearchParametersDto, required: false })
  searchParameters?: SerperWebSearchParametersDto;

  @ApiProperty({
    type: [SerperWebResultItemDto],
    description: '일반 검색 결과 (organic)',
  })
  organic!: SerperWebResultItemDto[];

  @ApiProperty({ required: false, description: 'API 크레딧' })
  credits?: number;
}
