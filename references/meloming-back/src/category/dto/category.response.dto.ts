import { ApiProperty } from '@nestjs/swagger';

class CategoryUserBriefDto {
  @ApiProperty({ example: 10 })
  id: number;

  @ApiProperty({ example: 'john' })
  nickname: string;
}

class CategoryChannelBriefDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'My Music Book' })
  name: string;

  @ApiProperty({ type: CategoryUserBriefDto })
  user: CategoryUserBriefDto;
}

export class CategoryListItemDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: '발라드' })
  name: string;

  @ApiProperty({ example: '#3B82F6' })
  color: string;

  @ApiProperty({ example: 1 })
  channelId: number;

  @ApiProperty({
    example: 200,
    nullable: true,
    description: '카테고리 신청곡 가격 (null이면 미설정)',
  })
  price: number | null;

  @ApiProperty({
    example: { SOOP_BALLOON: 200, CHZZK_CHEESE: 1000 },
    nullable: true,
    description: '재화별 카테고리 신청곡 가격',
  })
  currencyPrices: Record<string, number | null> | null;

  @ApiProperty({
    example: 1,
    nullable: true,
    description: '카테고리 표시 순서 (큰 숫자일수록 앞에 표시)',
  })
  displayOrder: number | null;

  @ApiProperty({ example: '2024-08-01T12:34:56.000Z', nullable: true })
  createdAt: Date | null;

  @ApiProperty({ example: 12, description: '해당 카테고리의 노래 수' })
  songCount: number;

  @ApiProperty({ type: CategoryChannelBriefDto })
  channel: CategoryChannelBriefDto;
}

export class CategoryDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: '발라드' })
  name: string;

  @ApiProperty({ example: '#3B82F6' })
  color: string;

  @ApiProperty({ example: 1 })
  channelId: number;

  @ApiProperty({
    example: 200,
    nullable: true,
    description: '카테고리 신청곡 가격 (null이면 미설정)',
  })
  price: number | null;

  @ApiProperty({
    example: { SOOP_BALLOON: 200, CHZZK_CHEESE: 1000 },
    nullable: true,
    description: '재화별 카테고리 신청곡 가격',
  })
  currencyPrices: Record<string, number | null> | null;

  @ApiProperty({
    example: 1,
    nullable: true,
    description: '카테고리 표시 순서 (큰 숫자일수록 앞에 표시)',
  })
  displayOrder: number | null;

  @ApiProperty({ example: '2024-08-01T12:34:56.000Z', nullable: true })
  createdAt: Date | null;
}

export class DeleteCategoryResponseDto {
  @ApiProperty({ example: '카테고리가 삭제되었습니다.' })
  message: string;
}
