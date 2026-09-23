import { ApiProperty } from '@nestjs/swagger';
import { SongRequestSource, SongRequestStatus } from '@prisma/client';
import { SearchPaginationMeta } from '../../../search/dto/paginated-search-response.dto';

export class SongRequestHistoryItemDto {
  @ApiProperty({ description: '신청 ID', example: 1 })
  id!: number;

  @ApiProperty({
    description:
      '신청자 닉네임. 익명 신청은 "익명", 탈퇴 사용자는 "(탈퇴한 사용자)" 로 마스킹되어 응답됨.',
    example: '치무',
  })
  requesterNickname!: string;

  @ApiProperty({ description: '익명 신청 여부', example: false })
  isAnonymous!: boolean;

  @ApiProperty({ enum: SongRequestStatus, description: '상태 (REJECTED 는 응답에서 제외됨)' })
  status!: SongRequestStatus;

  @ApiProperty({ enum: SongRequestSource, description: '신청 경로' })
  source!: SongRequestSource;

  @ApiProperty({
    nullable: true,
    description: 'KRW 환산 후원 금액 (DONATION 신청만 값 존재)',
    example: 5000,
  })
  donationAmount!: number | null;

  @ApiProperty({
    nullable: true,
    description: '후원 통화 코드',
    example: 'KRW',
  })
  donationCurrency!: string | null;

  @ApiProperty({
    description: '신청 시각 (ISO 8601)',
    example: '2026-05-10T00:00:00.000Z',
  })
  createdAt!: string;
}

export class SongRequestHistoryResponseDto {
  @ApiProperty({ type: [SongRequestHistoryItemDto] })
  requests!: SongRequestHistoryItemDto[];

  @ApiProperty({ type: SearchPaginationMeta })
  pagination!: SearchPaginationMeta;
}
