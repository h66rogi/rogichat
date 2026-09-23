import { ApiProperty } from '@nestjs/swagger';

export class FanBroadcastQuotaDto {
  @ApiProperty({ example: 2, description: '오늘 사용한 횟수 (KST 기준)' })
  used!: number;

  @ApiProperty({ example: 5, description: '일일 발송 가능 총 횟수' })
  limit!: number;

  @ApiProperty({ example: true, description: 'PRO 구독 활성 여부' })
  isPro!: boolean;

  @ApiProperty({
    example: '2026-04-24T15:00:00.000Z',
    description: 'KST 기준 다음 자정에 쿼터 리셋 (ISO-8601)',
  })
  resetAt!: string;
}
