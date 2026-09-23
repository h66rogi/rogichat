import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChannelAnniversariesDto } from '../../channel/dto/channel-profile.dto';

export class FavoriteToggleResponseDto {
  @ApiProperty({ description: '작업 성공 여부', example: true })
  success: boolean;
  @ApiProperty({ description: '현재 즐겨찾기 상태', example: true })
  isFavorite: boolean;
  @ApiProperty({
    description: '응답 메시지',
    example: '채널이 즐겨찾기에 추가되었습니다.',
  })
  message: string;
}

export class ChannelFavoriteDto {
  @ApiProperty({ description: '즐겨찾기 ID', example: 1 })
  id: number;
  @ApiProperty({ description: '채널 ID', example: 5 })
  channelId: number;
  @ApiProperty({ description: '채널 이름', example: '멜로밍의 노래책' })
  channelName: string;
  @ApiProperty({
    description: '채널 프로필 이미지 URL',
    example: 'https://example.com/profile.jpg',
    required: false,
  })
  profileImageUrl?: string;
  @ApiProperty({ description: '채널 주소', example: 'meloming_user' })
  webPath: string;
  @ApiProperty({ description: '채널 테마 색상', example: '#3B82F6' })
  themeColor: string;
  @ApiProperty({ description: '채널 소유자 닉네임', example: '멜로밍' })
  ownerNickname: string;
  @ApiPropertyOptional({
    description: '스트리머가 설정한 채널 상태 메시지',
    example: '오늘 밤 9시에 후여르에서 만나요',
  })
  channelDescription?: string;
  @ApiProperty({
    description: '즐겨찾기 추가 시간',
    example: '2025-01-20T10:30:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: '채널 등록 노래 수',
    example: 150,
  })
  songCount: number;

  @ApiProperty({
    description: '채널 아티스트 수',
    example: 30,
  })
  artistCount: number;

  @ApiProperty({
    description: '채널 즐겨찾기 수',
    example: 123,
  })
  favoritesCount: number;

  @ApiProperty({
    description: '채널 소유자의 프로 구독 활성 상태',
    example: true,
  })
  isOwnerProSubscriber: boolean;

  @ApiProperty({
    description: '채널 소유자의 앰배서더 여부',
    example: true,
  })
  isOwnerAmbassador: boolean;
}

export class SongFavoriteDto {
  @ApiProperty({ description: '즐겨찾기 ID', example: 1 })
  id: number;
  @ApiProperty({ description: '노래 ID', example: 10 })
  songId: number;
  @ApiProperty({ description: '노래 제목', example: '아이유 - 네모의꿈' })
  songTitle: string;
  @ApiProperty({ description: '아티스트 이름', example: '아이유' })
  artistName: string;
  @ApiProperty({
    description: '앨범 아트 URL',
    example: 'https://example.com/album-art.jpg',
    required: false,
  })
  albumArt?: string;
  @ApiProperty({ description: '채널 이름', example: '멜로밍의 노래책' })
  channelName: string;
  @ApiProperty({ description: '채널 주소', example: 'meloming_user' })
  webPath: string;
  @ApiProperty({
    description: '채널 프로필 이미지 URL',
    example: 'https://example.com/profile.jpg',
    required: false,
  })
  channelProfileImageUrl?: string;
  @ApiProperty({
    description: '즐겨찾기 추가 시간',
    example: '2025-01-20T10:30:00.000Z',
  })
  createdAt: Date;
}

export class MyChannelFavoritesResponseDto {
  @ApiProperty({
    description: '즐겨찾기한 채널 목록',
    type: [ChannelFavoriteDto],
  })
  favorites: ChannelFavoriteDto[];
  @ApiProperty({ description: '전체 즐겨찾기 수', example: 50 })
  total: number;
  @ApiProperty({ description: '현재 페이지', example: 1 })
  page: number;
  @ApiProperty({ description: '페이지당 항목 수', example: 20 })
  limit: number;
  @ApiProperty({ description: '전체 페이지 수', example: 3 })
  totalPages: number;
}

export class MySongFavoritesResponseDto {
  @ApiProperty({ description: '즐겨찾기한 노래 목록', type: [SongFavoriteDto] })
  favorites: SongFavoriteDto[];
  @ApiProperty({ description: '전체 즐겨찾기 수', example: 100 })
  total: number;
  @ApiProperty({ description: '현재 페이지', example: 1 })
  page: number;
  @ApiProperty({ description: '페이지당 항목 수', example: 20 })
  limit: number;
  @ApiProperty({ description: '전체 페이지 수', example: 5 })
  totalPages: number;
}

export class FavoriteStatusDto {
  @ApiProperty({ description: '즐겨찾기 여부', example: true })
  isFavorite: boolean;
  @ApiProperty({
    description: '즐겨찾기 추가 시간 (즐겨찾기한 경우)',
    example: '2025-01-20T10:30:00.000Z',
    required: false,
  })
  createdAt?: Date;
}

export class FavoriteStatsDto {
  @ApiProperty({ description: '내가 즐겨찾기한 채널 수', example: 15 })
  myChannelFavorites: number;
  @ApiProperty({ description: '내가 즐겨찾기한 노래 수', example: 45 })
  mySongFavorites: number;
}

export class SongFavoriteCountDto {
  @ApiProperty({ description: '노래 ID', example: 10 })
  songId: number;
  @ApiProperty({ description: '총 즐겨찾기 수', example: 127 })
  totalFavorites: number;
}

export class ChannelFavoriteCountDto {
  @ApiProperty({ description: '채널 ID', example: 5 })
  channelId: number;
  @ApiProperty({ description: '총 즐겨찾기 수', example: 89 })
  totalFavorites: number;
}

export class ChannelFavoritedUserDto {
  @ApiProperty({ description: '사용자 ID', example: 123 })
  userId: number;
  @ApiProperty({ description: '닉네임', example: 'meloming' })
  nickname: string;
  @ApiProperty({ description: '프로필 이미지 URL', required: false })
  profileImageUrl?: string;
  @ApiProperty({
    description: '즐겨찾기 추가 시간',
    example: '2025-01-20T10:30:00.000Z',
  })
  createdAt: Date;
}

export class ChannelFavoritedUsersResponseDto {
  @ApiProperty({
    description: '즐겨찾기한 사용자 목록',
    type: [ChannelFavoritedUserDto],
  })
  users: ChannelFavoritedUserDto[];
  @ApiProperty({ description: '전체 수', example: 42 })
  total: number;
  @ApiProperty({ description: '현재 페이지', example: 1 })
  page: number;
  @ApiProperty({ description: '페이지당 항목 수', example: 20 })
  limit: number;
  @ApiProperty({ description: '전체 페이지 수', example: 3 })
  totalPages: number;
}

export class FavoriteChannelAnniversariesItemDto {
  @ApiProperty({ description: '채널 ID', example: 5 })
  channelId: number;

  @ApiProperty({ description: '채널 이름', example: '멜로밍의 노래책' })
  channelName: string;

  @ApiProperty({ description: '채널 주소', example: 'meloming_user' })
  webPath: string;

  @ApiProperty({
    description: '채널 프로필 이미지 URL',
    required: false,
    example: 'https://example.com/profile.jpg',
  })
  profileImageUrl?: string | null;

  @ApiProperty({
    description: '채널 테마 색상',
    required: false,
    example: '#3B82F6',
  })
  themeColor?: string | null;

  @ApiProperty({
    description: '채널 기념일 요약 정보',
    required: false,
    nullable: true,
    type: ChannelAnniversariesDto,
  })
  anniversaries?: ChannelAnniversariesDto | null;
}

export class FavoriteChannelAnniversariesResponseDto {
  @ApiProperty({
    description: '내 즐겨찾기 채널 기념일 목록',
    type: [FavoriteChannelAnniversariesItemDto],
  })
  items: FavoriteChannelAnniversariesItemDto[];
}
