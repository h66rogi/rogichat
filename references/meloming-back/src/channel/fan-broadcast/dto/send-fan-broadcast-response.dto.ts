import { ApiProperty } from '@nestjs/swagger';

export class SendFanBroadcastResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ example: 1234, description: '대상 채널 ID' })
  channelId!: number;

  @ApiProperty({
    example: 156,
    description: '발송 요청된 수신자 수 (본인 제외, 중복 제거 후 큐 적재 기준)',
  })
  enqueuedCount!: number;

  @ApiProperty({
    example: 3,
    description: '오늘 사용한 누적 횟수 (이번 발송 포함)',
  })
  usedQuotaToday!: number;

  @ApiProperty({ example: 5, description: '일일 발송 가능 총 횟수' })
  dailyQuota!: number;

  @ApiProperty({
    example: '2026-04-24T15:00:00.000Z',
    description: 'KST 기준 다음 자정에 쿼터 리셋 (ISO-8601)',
  })
  resetAt!: string;
}
