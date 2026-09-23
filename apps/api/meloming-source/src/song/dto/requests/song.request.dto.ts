import {
  IsString,
  IsOptional,
  IsUrl,
  IsNumber,
  IsBoolean,
  IsArray,
  ArrayMaxSize,
  ArrayMinSize,
  Min,
  Max,
  ValidateNested,
  IsEnum,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiHideProperty, ApiProperty, PartialType } from '@nestjs/swagger';

export class CreateSongRequestDto {
  @ApiProperty({ description: '노래 제목', example: 'Dynamite' })
  @IsString()
  title: string;

  @ApiProperty({
    description: '아티스트 ID (기존 아티스트 선택 시)',
    example: 1,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  artistId?: number;

  @ApiProperty({
    description: '아티스트 이름 (새로운 아티스트 생성 시)',
    example: 'BTS',
    required: false,
  })
  @IsOptional()
  @IsString()
  artistName?: string;

  @ApiProperty({
    description: '앨범 아트 URL',
    example: 'https://example.com/album.jpg',
    required: false,
  })
  @IsOptional()
  @IsUrl()
  albumArt?: string;

  @ApiProperty({
    description: '노래방 반주 URL',
    example: 'https://youtube.com/karaoke',
    required: false,
  })
  @IsOptional()
  @IsUrl()
  karaokeUrl?: string;

  @ApiProperty({
    description: '커버 영상 URL',
    example: 'https://youtube.com/cover',
    required: false,
  })
  @IsOptional()
  @IsUrl()
  coverUrl?: string;

  @ApiProperty({
    description: '원곡 영상 URL',
    example: 'https://youtube.com/original',
    required: false,
  })
  @IsOptional()
  @IsUrl()
  originalUrl?: string;

  @ApiProperty({
    description: '난이도 (1-5)',
    example: 3,
    minimum: 1,
    maximum: 5,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  difficulty?: number;

  @ApiProperty({
    description: '숙련도 (1-5)',
    example: 3,
    minimum: 1,
    maximum: 5,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  proficiency?: number;

  @ApiProperty({
    description: '노래 키 (예: C, C#, D)',
    example: 'C#',
    required: false,
  })
  @IsOptional()
  @IsString()
  songKey?: string;

  @ApiProperty({
    description: 'BPM (Beats Per Minute)',
    example: 120,
    minimum: 40,
    maximum: 300,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(40)
  @Max(300)
  bpm?: number;

  @ApiProperty({
    description: '가사 링크',
    example: 'https://lyrics.example.com',
    required: false,
  })
  @IsOptional()
  @IsUrl()
  lyricsLink?: string;

  @ApiProperty({
    description: '가사 텍스트',
    example: '오늘 밤 너와 함께...',
    required: false,
  })
  @IsOptional()
  @IsString()
  lyricsText?: string;

  @ApiProperty({
    description: '설명',
    example: '노래 소개나 배경 등을 자유롭게 작성합니다.',
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: '카테고리 ID 목록 (기존 카테고리 선택 시)',
    example: [1, 2],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  categoryIds?: number[];

  @ApiProperty({
    description: '카테고리 이름 목록 (새로운 카테고리 생성 시)',
    example: ['발라드', '댄스'],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categoryNames?: string[];

  @ApiProperty({
    description: '앨범 아트 자동 검색 여부',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  autoSearchAlbumArt?: boolean;
}

export class BulkCreateSongRequestDto {
  @ApiProperty({
    description: '노래 목록',
    type: [CreateSongRequestDto],
    example: [{ title: 'Dynamite', artistName: 'BTS' }],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSongRequestDto)
  @ArrayMinSize(1, { message: '최소 1개 이상의 노래를 입력해야 합니다.' })
  @ArrayMaxSize(500, {
    message: '한 번에 최대 500개까지만 추가할 수 있습니다.',
  })
  songs: CreateSongRequestDto[];
}

export class UpdateSongRequestDto extends PartialType(CreateSongRequestDto) {}

export class SearchSongRequestDto {
  @ApiProperty({ description: '노래 제목', example: 'Dynamite' })
  @IsString()
  title: string;

  @ApiProperty({ description: '아티스트명', example: 'BTS' })
  @IsString()
  artist: string;
}

export class BulkAlbumArtSearchRequestDto {
  @ApiProperty({
    description: '검색할 노래 목록 (최대 500곡)',
    type: [SearchSongRequestDto],
    example: [{ title: 'Dynamite', artist: 'BTS' }],
  })
  @IsArray()
  @ArrayMaxSize(500, { message: '최대 500곡까지 한번에 검색할 수 있습니다.' })
  @ArrayMinSize(1, { message: '최소 1곡 이상 입력해주세요.' })
  @ValidateNested({ each: true })
  @Type(() => SearchSongRequestDto)
  songs: SearchSongRequestDto[];

  @ApiProperty({
    description: '응답에 상세 정보 포함 여부',
    example: false,
    required: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  includeDetails?: boolean;

  @ApiProperty({
    description: '매칭 결과만 반환 (null 제외)',
    example: true,
    required: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  onlyMatched?: boolean;
}

export class BulkDeleteSongsRequestDto {
  @ApiProperty({
    description: '삭제할 노래 ID 목록 (최대 300개)',
    type: [Number],
    example: [1, 2, 3],
  })
  @IsArray()
  @ArrayMinSize(1, { message: '최소 1개 이상의 ID를 입력해야 합니다.' })
  @ArrayMaxSize(300, {
    message: '한 번에 최대 300개까지만 삭제할 수 있습니다.',
  })
  @IsNumber({}, { each: true })
  ids: number[];
}

export class SongQueryRequestDto {
  @ApiProperty({
    description: '페이지 번호',
    example: 1,
    required: false,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiProperty({
    description: '페이지당 항목 수',
    example: 20,
    required: false,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiProperty({
    description: '검색어 (제목, 아티스트명 검색)',
    example: 'Dynamite',
    required: false,
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({
    description: 'API 버전 (v2 선택 시 다중 필터 지원)',
    example: 'v2',
    required: false,
    enum: ['v1', 'v2'],
  })
  @IsOptional()
  @IsEnum(['v1', 'v2'])
  version?: 'v1' | 'v2';

  @ApiProperty({
    description: '카테고리 ID로 필터',
    example: 1,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  categoryId?: number;

  @ApiProperty({
    description: '아티스트 ID로 필터',
    example: 1,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  artistId?: number;

  @ApiProperty({
    description: '난이도로 필터 (1-5)',
    example: 3,
    required: false,
    minimum: 1,
    maximum: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(5)
  difficulty?: number;

  @ApiProperty({
    description: '숙련도로 필터 (1-5)',
    example: 3,
    required: false,
    minimum: 1,
    maximum: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(5)
  proficiency?: number;

  @ApiProperty({
    description: '정렬 기준',
    example: 'newest',
    required: false,
    enum: [
      'newest',
      'oldest',
      'title',
      'artist',
      'favorites_desc',
      'favorites_asc',
    ],
  })
  @IsOptional()
  @IsEnum([
    'newest',
    'oldest',
    'title',
    'artist',
    'favorites_desc',
    'favorites_asc',
  ])
  sortBy?:
    | 'newest'
    | 'oldest'
    | 'title'
    | 'artist'
    | 'favorites_desc'
    | 'favorites_asc' = 'newest';

  // V2 전용 필드들 (version=v2일 때만 사용)
  @ApiHideProperty()
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((v) => parseInt(v.trim(), 10))
        .filter((v) => !isNaN(v));
    }
    if (Array.isArray(value)) {
      return value.map((v) => parseInt(v, 10)).filter((v) => !isNaN(v));
    }
    return [parseInt(value, 10)].filter((v) => !isNaN(v));
  })
  @IsArray()
  @IsNumber({}, { each: true })
  categoryIds?: number[];

  @ApiHideProperty()
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((v) => parseInt(v.trim(), 10))
        .filter((v) => !isNaN(v));
    }
    if (Array.isArray(value)) {
      return value.map((v) => parseInt(v, 10)).filter((v) => !isNaN(v));
    }
    return [parseInt(value, 10)].filter((v) => !isNaN(v));
  })
  @IsArray()
  @IsNumber({}, { each: true })
  artistIds?: number[];

  @ApiHideProperty()
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((v) => parseInt(v.trim(), 10))
        .filter((v) => !isNaN(v) && v >= 1 && v <= 5);
    }
    if (Array.isArray(value)) {
      return value
        .map((v) => parseInt(v, 10))
        .filter((v) => !isNaN(v) && v >= 1 && v <= 5);
    }
    const num = parseInt(value, 10);
    return !isNaN(num) && num >= 1 && num <= 5 ? [num] : [];
  })
  @IsArray()
  @IsNumber({}, { each: true })
  @Min(1, { each: true })
  @Max(5, { each: true })
  difficulties?: number[];

  @ApiHideProperty()
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((v) => parseInt(v.trim(), 10))
        .filter((v) => !isNaN(v) && v >= 1 && v <= 5);
    }
    if (Array.isArray(value)) {
      return value
        .map((v) => parseInt(v, 10))
        .filter((v) => !isNaN(v) && v >= 1 && v <= 5);
    }
    const num = parseInt(value, 10);
    return !isNaN(num) && num >= 1 && num <= 5 ? [num] : [];
  })
  @IsArray()
  @IsNumber({}, { each: true })
  @Min(1, { each: true })
  @Max(5, { each: true })
  proficiencies?: number[];
}
