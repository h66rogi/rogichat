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
  MaxLength,
  ValidateNested,
  IsEnum,
  IsNotEmpty,
  IsObject,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiHideProperty, ApiProperty, PartialType } from '@nestjs/swagger';

export class CreateSongDto {
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
    description:
      '콘솔 키 조절(pitch shift) 저장값. semitone 오프셋. -12..+12. null 로 초기화.',
    example: 2,
    minimum: -12,
    maximum: 12,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(-12)
  @Max(12)
  preferredPitchSemitones?: number | null;

  @ApiProperty({
    description:
      '콘솔 가사 sync 보정값(ms). -60000..+60000. null 로 초기화. 양수=가사를 늦춤, 음수=가사를 앞당김.',
    example: 200,
    minimum: -60000,
    maximum: 60000,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(-60000)
  @Max(60000)
  preferredLyricsOffsetMs?: number | null;

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
    description: '신청곡 가격 (null이면 기본 가격 적용)',
    example: 500,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiProperty({
    description: '재화별 곡 가격 (신청곡 기능용)',
    example: { SOOP_BALLOON: 500, CHZZK_CHEESE: 2000 },
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsObject()
  currencyPrices?: Record<string, number | null> | null;

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

export class BulkCreateSongDto {
  @ApiProperty({
    description: '노래 목록',
    type: [CreateSongDto],
    example: [
      {
        title: 'Dynamite',
        artistName: 'BTS',
        categoryNames: ['K-POP', '댄스'],
        albumArt: 'https://example.com/dynamite.jpg',
      },
      {
        title: 'Butter',
        artistId: 1,
        categoryIds: [1, 2],
        albumArt: 'https://example.com/butter.jpg',
      },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSongDto)
  @ArrayMinSize(1, { message: '최소 1개 이상의 노래를 입력해야 합니다.' })
  @ArrayMaxSize(500, {
    message: '한 번에 최대 500개까지만 추가할 수 있습니다.',
  })
  songs: CreateSongDto[];
}

export class UpdateSongDto extends PartialType(CreateSongDto) {}

export class CreateMultipleSongsDto {
  @ApiProperty({
    description: '여러 노래 정보 배열',
    type: [CreateSongDto],
    example: [
      {
        title: 'Dynamite',
        artistName: 'BTS',
        categoryNames: ['팝', '댄스'],
        autoSearchAlbumArt: true,
      },
      {
        title: 'Spring Day',
        artistId: 1,
        categoryIds: [1, 2],
        difficulty: 3,
      },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSongDto)
  songs: CreateSongDto[];

  @ApiProperty({
    description: '실패 시 전체 롤백 여부',
    example: true,
    required: false,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  rollbackOnError?: boolean;

  @ApiProperty({
    description: '중복 체크 여부 (제목 + 아티스트)',
    example: true,
    required: false,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  checkDuplicates?: boolean;
}

export class SearchSongDto {
  @ApiProperty({ description: '노래 제목', example: 'Dynamite' })
  @IsString()
  title: string;

  @ApiProperty({ description: '아티스트명', example: 'BTS' })
  @IsString()
  artist: string;
}

export class BulkAlbumArtSearchDto {
  @ApiProperty({
    description: '검색할 노래 목록 (최대 500곡)',
    type: [SearchSongDto],
    example: [
      { title: 'Dynamite', artist: 'BTS' },
      { title: '봄날', artist: '방탄소년단' },
      { title: 'IU - Through the Night', artist: 'IU' },
    ],
  })
  @IsArray()
  @ArrayMaxSize(500, { message: '최대 500곡까지 한번에 검색할 수 있습니다.' })
  @ArrayMinSize(1, { message: '최소 1곡 이상 입력해주세요.' })
  @ValidateNested({ each: true })
  @Type(() => SearchSongDto)
  songs: SearchSongDto[];

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

export class BulkDeleteSongsDto {
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

// 일괄 수정용 DTO
export class BulkUpdateSongItemDto {
  @ApiProperty({
    description: '수정할 노래 ID',
    example: 1,
  })
  @IsNumber()
  id: number;

  @ApiProperty({
    description: '아티스트 ID',
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
    description: '카테고리 ID 목록',
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
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  proficiency?: number | null;

  @ApiProperty({
    description: '곡별 신청 가격 (null이면 직접 가격 해제)',
    example: 500,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price?: number | null;

  @ApiProperty({
    description: '재화별 곡 가격 (null이면 재화별 가격 해제)',
    example: { SOOP_BALLOON: 500, CHZZK_CHEESE: 2000 },
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsObject()
  currencyPrices?: Record<string, number | null> | null;
}

export class BulkUpdateSongsDto {
  @ApiProperty({
    description: '수정할 노래 목록 (최대 300개)',
    type: [BulkUpdateSongItemDto],
    example: [
      { id: 1, artistId: 2, difficulty: 3 },
      { id: 2, categoryIds: [1, 2] },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkUpdateSongItemDto)
  @ArrayMinSize(1, { message: '최소 1개 이상의 노래를 입력해야 합니다.' })
  @ArrayMaxSize(300, {
    message: '한 번에 최대 300개까지만 수정할 수 있습니다.',
  })
  songs: BulkUpdateSongItemDto[];
}

export class BulkUpdateSongsResponseDto {
  @ApiProperty({ description: '성공 여부', example: true })
  success: boolean;

  @ApiProperty({ description: '수정된 노래 개수', example: 5 })
  updatedCount: number;

  @ApiProperty({
    description: '수정된 노래 ID 목록',
    example: [1, 2, 3],
  })
  updatedIds: number[];
}

// 응답 스펙 고정: 벌크 생성 응답 DTO
export class BulkCreateSongsResponseDto {
  @ApiProperty({ description: '성공 여부', example: true })
  success: boolean;

  @ApiProperty({ description: '생성된 노래 개수', example: 5 })
  createdCount: number;

  @ApiProperty({
    description: '중복으로 건너뛴 노래 개수',
    example: 2,
    required: false,
  })
  skippedCount?: number;

  @ApiProperty({ description: '새로 생성된 아티스트 수', example: 2 })
  newArtistsCount: number;

  @ApiProperty({ description: '새로 생성된 카테고리 수', example: 1 })
  newCategoriesCount: number;

  @ApiProperty({
    description: '생성된 노래 요약 목록',
    example: [
      { id: 123, title: 'Dynamite' },
      { id: 124, title: 'Butter' },
    ],
  })
  songs: { id: number; title: string }[];

  @ApiProperty({
    description: '중복으로 건너뛴 노래 요약 목록',
    example: [
      { title: 'Dynamite', artistName: 'BTS', reason: 'already_exists' },
      { title: 'Butter', artistName: 'BTS', reason: 'duplicate_in_request' },
    ],
    required: false,
  })
  skippedSongs?: {
    title: string;
    artistName?: string;
    artistId?: number;
    reason: 'duplicate_in_request' | 'already_exists';
  }[];
}

export interface SongDetailResponse {
  // Open shape: response objects pass through arbitrary Prisma fields
  // (channel, artist, categories, likes, …). Index signature preserves the
  // pre-Phase-5.3 `Record<string, unknown>` behavior so existing callers stay
  // type-compatible.
  [key: string]: unknown;
}

export type SongsListResponseItem = SongDetailResponse;

export interface SongsListResponse {
  songs: SongsListResponseItem[];
  total: number;
  page: number;
  limit: number;
}

// RESTful Song API용 Query Parameter DTO
export class SongQueryDto {
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
      'likes_desc',
      'likes_asc',
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
    'likes_desc',
    'likes_asc',
  ])
  sortBy?:
    | 'newest'
    | 'oldest'
    | 'title'
    | 'artist'
    | 'favorites_desc'
    | 'favorites_asc'
    | 'likes_desc'
    | 'likes_asc' = 'newest';

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
