import {
  IsString,
  IsOptional,
  IsUrl,
  IsArray,
  MinLength,
  IsNumber,
  Min,
  Max,
  IsBoolean,
  IsEnum,
  Matches,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { type ChannelVisibility } from '@prisma/client';
import { IsNotReservedHandle } from '../validators/not-reserved-handle.validator';

export class AdditionalLinkDto {
  @ApiProperty({ description: '링크 이름', example: '트위터' })
  @IsString()
  name: string;

  @ApiProperty({
    description: '링크 URL',
    example: 'https://twitter.com/meloming_user',
  })
  @IsUrl()
  url: string;
}

export class CreateChannelDto {
  @ApiProperty({ description: '뮤직북 이름', example: '내 뮤직북' })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiProperty({
    description:
      '채널 주소 (고유 식별자, 영어로 시작, 영어/숫자/언더스코어/하이픈만 허용)',
    example: 'my_music_book',
  })
  @IsString()
  @MinLength(1)
  @Matches(/^[a-zA-Z][a-zA-Z0-9_-]*$/, {
    message:
      '채널 주소는 영어로 시작해야 하며, 영어, 숫자, 언더스코어(_), 하이픈(-)만 사용할 수 있습니다.',
  })
  @IsNotReservedHandle()
  webPath: string;

  @ApiProperty({
    description:
      '방송 플랫폼 URL (초기 설정용, 이후 변경은 채널 인증을 통해서만 가능)',
    example: 'https://twitch.tv/my_channel',
    required: false,
  })
  @IsOptional()
  @ValidateIf((o) => !!o.platformUrl)
  @IsUrl()
  platformUrl?: string;

  @ApiProperty({
    description: '상단 배너 이미지 URL',
    example: 'https://example.com/top-banner.jpg',
    required: false,
  })
  @IsOptional()
  @IsUrl()
  topBannerUrl?: string;

  @ApiProperty({
    description: '왼쪽 사이드 배너 이미지 URL',
    example: 'https://example.com/left-banner.jpg',
    required: false,
  })
  @IsOptional()
  @IsUrl()
  leftBannerUrl?: string;

  @ApiProperty({
    description: '좌측 배너 클릭 링크 URL',
    required: false,
  })
  @IsOptional()
  @IsUrl()
  leftBannerLink?: string;

  @ApiProperty({
    description: '오른쪽 사이드 배너 이미지 URL',
    example: 'https://example.com/right-banner.jpg',
    required: false,
  })
  @IsOptional()
  @IsUrl()
  rightBannerUrl?: string;

  @ApiProperty({
    description: '우측 배너 클릭 링크 URL',
    required: false,
  })
  @IsOptional()
  @IsUrl()
  rightBannerLink?: string;

  @ApiProperty({
    description: '프로필 이미지 URL',
    example: 'https://example.com/profile.jpg',
    required: false,
  })
  @IsOptional()
  @IsUrl()
  profileImageUrl?: string;

  @ApiProperty({
    description: '테마 컬러',
    example: '#ff6b35',
    required: false,
  })
  @IsOptional()
  @IsString()
  themeColor?: string;

  @ApiProperty({
    description: '뮤직북 설명',
    example: '내 노래들을 모아둔 곳입니다.',
    required: false,
  })
  @IsOptional()
  @IsString()
  channelDescription?: string;

  @ApiProperty({
    description: '추가 링크 목록',
    type: [AdditionalLinkDto],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @Type(() => AdditionalLinkDto)
  additionalLinks?: AdditionalLinkDto[];
}

export class UpdateChannelDto {
  @ApiProperty({
    description: '뮤직북 이름',
    example: '새로운 뮤직북',
    required: false,
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({
    description: '채널 주소 (영어로 시작, 영어/숫자/언더스코어/하이픈만 허용)',
    example: 'new_web_path',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z][a-zA-Z0-9_-]*$/, {
    message:
      '채널 주소는 영어로 시작해야 하며, 영어, 숫자, 언더스코어(_), 하이픈(-)만 사용할 수 있습니다.',
  })
  @IsNotReservedHandle()
  webPath?: string;

  @ApiProperty({
    description: '방송 플랫폼 URL (무시됨 - 채널 인증을 통해서만 변경 가능)',
    example: 'https://youtube.com/new_channel',
    required: false,
    deprecated: true,
  })
  @IsOptional()
  @ValidateIf((o) => !!o.platformUrl)
  @IsUrl()
  platformUrl?: string;

  @ApiProperty({
    description: '상단 배너 이미지 URL (선택 사항)',
    example: 'https://cdn.meloming.com/banners/top-banner.jpg',
    required: false,
  })
  @IsOptional()
  @IsUrl()
  topBannerUrl?: string;

  @ApiProperty({
    description: '왼쪽 사이드 배너 이미지 URL (선택 사항)',
    example: 'https://cdn.meloming.com/banners/left-banner.jpg',
    required: false,
  })
  @IsOptional()
  @IsUrl()
  leftBannerUrl?: string;

  @ApiProperty({ description: '좌측 배너 클릭 링크', required: false })
  @IsOptional()
  @IsUrl()
  leftBannerLink?: string;

  @ApiProperty({
    description: '오른쪽 사이드 배너 이미지 URL (선택 사항)',
    example: 'https://cdn.meloming.com/banners/right-banner.jpg',
    required: false,
  })
  @IsOptional()
  @IsUrl()
  rightBannerUrl?: string;

  @ApiProperty({ description: '우측 배너 클릭 링크', required: false })
  @IsOptional()
  @IsUrl()
  rightBannerLink?: string;

  @ApiProperty({
    description: '프로필 이미지 URL (선택 사항)',
    example: 'https://example.com/profile.jpg',
    required: false,
  })
  @IsOptional()
  @IsUrl()
  profileImageUrl?: string;

  @ApiProperty({
    description: '추가 링크 목록 (선택 사항)',
    type: [AdditionalLinkDto],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @Type(() => AdditionalLinkDto)
  additionalLinks?: AdditionalLinkDto[];

  @ApiProperty({
    description: '테마 컬러 (선택 사항)',
    example: '#ff6b35',
    required: false,
  })
  @IsOptional()
  @IsString()
  themeColor?: string;

  @ApiProperty({
    description: '뮤직북 설명 (선택 사항)',
    example: '업데이트된 뮤직북 설명입니다.',
    required: false,
  })
  @IsOptional()
  @IsString()
  channelDescription?: string;

  @ApiProperty({
    description: '채널 공개 범위 (PUBLIC: 공개, UNLISTED: 링크 공유만)',
    enum: ['PUBLIC', 'UNLISTED'],
    required: false,
  })
  @IsOptional()
  @IsEnum(['PUBLIC', 'UNLISTED'])
  visibility?: ChannelVisibility;
}

export class ChannelQueryDto {
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
    example: 10,
    required: false,
    default: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 10;

  @ApiProperty({
    description: '통계 정보 포함 여부',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  expand?: boolean;
}

export class ChannelSearchQueryDto extends ChannelQueryDto {
  @ApiProperty({ description: '검색 키워드', example: '음악' })
  @IsString()
  @MinLength(1)
  keyword: string;
}

export class ChannelListQueryDto {
  @ApiProperty({
    description: '조회 개수',
    example: 10,
    required: false,
    default: 10,
    minimum: 1,
    maximum: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50)
  limit?: number = 10;
}
